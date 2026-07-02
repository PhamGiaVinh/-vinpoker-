-- F&B GQR-M1 — Guest QR table-ordering: SCHEMA + settings + owner token RPCs. DEPENDS ON
-- 000001 (is_club_fnb/is_club_owner), 000002 (fnb_orders/fnb_settings), 000004 (fnb_update_settings),
-- 000007 (fnb_expire_pending_orders), 000014 (table_ref). SOURCE-ONLY.
--
-- Apply in a controlled session (SQL Editor / Management API), owner-gated, AFTER review. NOT
-- `db push` / not `db reset` / not `migration up` / not deploy_db. schema_migrations untouched.
-- types.ts regen separate. Numbers 20261111000017/18/19 verified FREE on origin/main (2026-07-02);
-- the SePay settle extension is deliberately NOT here — it must be tail-numbered (see GQR-M4,
-- 20261211000000) because settle/parse are owned by 20261113/20261118 files (replay ordering).
--
-- WHY: guests scan ONE QR per table → phone opens /fnb/order?t=<token> → "Bạn đang ngồi tại Bàn X"
--   → pick seat → menu → order → pay by bank transfer (VietQR + SePay auto-confirm, GQR-M4) or cash
--   (a server collects at the table, GQR-M3 lets the server facet mark table-cash orders paid).
--   Orders auto-link to the table via the A2 table_ref.
--
-- WHAT (this file): payment_method enum + 4 new fnb_orders columns; the per-table secret-token
--   table; 3 per-club guest settings; fnb_update_settings 4-arg → 7-arg (DROP+CREATE, overload
--   lesson from …0010/…0014); fnb_expire_pending_orders clone with a per-method TTL (bank orders
--   get the longer guest_bank_ttl_secs so a slow transfer doesn't expire mid-payment); owner-only
--   token issue/revoke/list RPCs. The anon guest RPCs are the NEXT migration (…0018).
--
-- FLAG: fnbGuestOrder (default false) — everything ships dark. Per-club server-side kill switch:
--   fnb_settings.guest_order_enabled (default false). ROLLBACK: bottom of file.

-- ===========================================================================================
-- 1. Enum — how the guest chose to pay. Legacy/counter orders default 'cash' (history unchanged:
--    every existing order was collected in cash at the counter).
-- ===========================================================================================
DO $$ BEGIN
  CREATE TYPE public.fnb_payment_method AS ENUM ('cash', 'bank_transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================================
-- 2. fnb_orders — guest-order columns (all idempotent ADD COLUMN IF NOT EXISTS).
-- ===========================================================================================
ALTER TABLE public.fnb_orders
  ADD COLUMN IF NOT EXISTS payment_method public.fnb_payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS reference_code text,          -- FNB-{8hex} memo for bank matching (NULL = not bank)
  ADD COLUMN IF NOT EXISTS qr_token_id    uuid,          -- soft ref → fnb_table_qr_tokens.id (audit + status authz)
  ADD COLUMN IF NOT EXISTS guest_seat     smallint CHECK (guest_seat IS NULL OR guest_seat BETWEEN 1 AND 20);

COMMENT ON COLUMN public.fnb_orders.reference_code IS
  'GQR: unique FNB-{8hex} bank-transfer memo; matched by settle_bank_transaction (GQR-M4). NULL for cash/counter.';

-- bank memo matching is case-insensitive and must be unique across ALL orders.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_orders_reference_code
  ON public.fnb_orders (upper(reference_code)) WHERE reference_code IS NOT NULL;

-- guest pending-cap lookup (…0018) + serve-page queue.
CREATE INDEX IF NOT EXISTS idx_fnb_orders_table_pending
  ON public.fnb_orders (club_id, table_ref, status) WHERE status = 'pending';

-- ===========================================================================================
-- 3. fnb_table_qr_tokens — ONE secret token per table (the QR encodes /fnb/order?t=<token>).
--    Rotation = deactivate + insert (atomic inside fnb_issue_table_qr_token). Token is SECRET
--    MATERIAL → RLS is OWNER-ONLY (tighter than other fnb_* tables; staff never need plaintext).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.fnb_table_qr_tokens (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_ref   uuid NOT NULL,                             -- soft ref → game_tables.id (A2 convention, no FK)
  token       text NOT NULL UNIQUE,                      -- 64 hex chars (2× gen_random_uuid, ~244 bits)
  label       text,                                      -- optional print label override
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid,
  revoked_at  timestamptz
);

-- one ACTIVE token per table (rotation-safe at the DB level).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_table_qr_one_active
  ON public.fnb_table_qr_tokens (club_id, table_ref) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_fnb_table_qr_club
  ON public.fnb_table_qr_tokens (club_id, is_active);

ALTER TABLE public.fnb_table_qr_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fnb_table_qr_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fnb_table_qr_tokens TO authenticated;

DROP POLICY IF EXISTS fnb_table_qr_tokens_select ON public.fnb_table_qr_tokens;
CREATE POLICY fnb_table_qr_tokens_select ON public.fnb_table_qr_tokens
  FOR SELECT TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id));    -- owner-only: plaintext tokens are secrets

-- ===========================================================================================
-- 4. fnb_settings — per-club guest-ordering config.
-- ===========================================================================================
ALTER TABLE public.fnb_settings
  ADD COLUMN IF NOT EXISTS guest_order_enabled     boolean NOT NULL DEFAULT false, -- server-side kill switch
  ADD COLUMN IF NOT EXISTS guest_bank_auto_confirm boolean NOT NULL DEFAULT false, -- GQR-M4 settle gate
  ADD COLUMN IF NOT EXISTS guest_bank_ttl_secs     int     NOT NULL DEFAULT 1800 CHECK (guest_bank_ttl_secs > 0);

-- ===========================================================================================
-- 5. fnb_update_settings — 4-arg → 7-arg. Adding defaulted args creates a NEW OVERLOAD, so DROP
--    the exact old signature first (PostgREST-ambiguity lesson from …0010's fnb_upsert_menu_item
--    and …0014's fnb_create_order). Body cloned from …0004 + the 3 new fields.
-- ===========================================================================================
DROP FUNCTION IF EXISTS public.fnb_update_settings(uuid, int, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fnb_update_settings(
  p_club_id                   uuid,
  p_pending_ttl_secs          int     DEFAULT NULL,
  p_restock_on_shipped_cancel boolean DEFAULT NULL,
  p_fnb_in_club_net           boolean DEFAULT NULL,
  p_guest_order_enabled       boolean DEFAULT NULL,
  p_guest_bank_auto_confirm   boolean DEFAULT NULL,
  p_guest_bank_ttl_secs       int     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF p_pending_ttl_secs IS NOT NULL AND p_pending_ttl_secs <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'pending_ttl_secs');
  END IF;
  IF p_guest_bank_ttl_secs IS NOT NULL AND p_guest_bank_ttl_secs <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'guest_bank_ttl_secs');
  END IF;

  INSERT INTO public.fnb_settings
    (club_id, pending_ttl_secs, restock_on_shipped_cancel, fnb_in_club_net,
     guest_order_enabled, guest_bank_auto_confirm, guest_bank_ttl_secs, updated_at, updated_by)
  VALUES
    (p_club_id, COALESCE(p_pending_ttl_secs, 900), COALESCE(p_restock_on_shipped_cancel, false),
     COALESCE(p_fnb_in_club_net, false), COALESCE(p_guest_order_enabled, false),
     COALESCE(p_guest_bank_auto_confirm, false), COALESCE(p_guest_bank_ttl_secs, 1800), now(), v_uid)
  ON CONFLICT (club_id) DO UPDATE SET
    pending_ttl_secs          = COALESCE(p_pending_ttl_secs, public.fnb_settings.pending_ttl_secs),
    restock_on_shipped_cancel = COALESCE(p_restock_on_shipped_cancel, public.fnb_settings.restock_on_shipped_cancel),
    fnb_in_club_net           = COALESCE(p_fnb_in_club_net, public.fnb_settings.fnb_in_club_net),
    guest_order_enabled       = COALESCE(p_guest_order_enabled, public.fnb_settings.guest_order_enabled),
    guest_bank_auto_confirm   = COALESCE(p_guest_bank_auto_confirm, public.fnb_settings.guest_bank_auto_confirm),
    guest_bank_ttl_secs       = COALESCE(p_guest_bank_ttl_secs, public.fnb_settings.guest_bank_ttl_secs),
    updated_at                = now(),
    updated_by                = v_uid;

  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_update_settings(uuid, int, boolean, boolean, boolean, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_update_settings(uuid, int, boolean, boolean, boolean, boolean, int) TO authenticated;

-- ===========================================================================================
-- 6. fnb_expire_pending_orders — clone of …0007 with a PER-METHOD TTL: bank_transfer pending
--    orders use guest_bank_ttl_secs (default 1800s) so a guest mid-transfer isn't expired at the
--    900s counter TTL. Same SKIP LOCKED safety (never contends with an in-flight mark_paid/settle).
--    Replay-safe: …0017 > …0007 so this definition wins on a fresh replay.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_expire_pending_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH due AS (
    SELECT o.id, o.club_id
    FROM public.fnb_orders o
    WHERE o.status = 'pending'
      AND o.created_at < now() - (
            CASE WHEN o.payment_method = 'bank_transfer'
                 THEN COALESCE((SELECT s.guest_bank_ttl_secs FROM public.fnb_settings s WHERE s.club_id = o.club_id), 1800)
                 ELSE COALESCE((SELECT s.pending_ttl_secs   FROM public.fnb_settings s WHERE s.club_id = o.club_id), 900)
            END * interval '1 second')
    FOR UPDATE SKIP LOCKED                       -- never contend with an in-flight fnb_mark_paid / settle
  ),
  upd AS (
    UPDATE public.fnb_orders o
      SET status = 'expired', updated_at = now()
      FROM due
      WHERE o.id = due.id
      RETURNING o.id, o.club_id
  ),
  ev AS (
    INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status)
    SELECT id, club_id, 'expired', 'pending', 'expired' FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;          -- PENDING never moved stock → pure status flip + event

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_expire_pending_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_expire_pending_orders() TO service_role;

-- ===========================================================================================
-- 7. Owner token RPCs — issue (atomic rotate) / revoke / list. Owner-only; plaintext tokens are
--    returned ONLY here (for the print sheet). SECURITY DEFINER + explicit authz, house REVOKE/GRANT.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_issue_table_qr_token(
  p_club_id   uuid,
  p_table_ref uuid,
  p_label     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_token   text;
  v_id      uuid;
  v_attempt int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  -- table must belong to this club (A2 INVALID_TABLE_REF idiom; definer read bypasses game_tables RLS).
  IF NOT EXISTS (SELECT 1 FROM public.game_tables gt WHERE gt.id = p_table_ref AND gt.club_id = p_club_id) THEN
    RETURN jsonb_build_object('error', 'INVALID_TABLE_REF');
  END IF;

  -- atomic ROTATE: deactivate any current active token, then insert the new one. Two CONCURRENT
  -- rotations can race the one-active partial unique index (the loser's UPDATE can't see the
  -- winner's post-snapshot insert) → catch unique_violation, re-run the deactivate once, retry
  -- (review finding; keeps the house {error:'CODE'} contract instead of a raw 23505).
  FOR v_attempt IN 1..2 LOOP
    UPDATE public.fnb_table_qr_tokens
      SET is_active = false, revoked_by = v_uid, revoked_at = now()
      WHERE club_id = p_club_id AND table_ref = p_table_ref AND is_active;

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    BEGIN
      INSERT INTO public.fnb_table_qr_tokens (club_id, table_ref, token, label, created_by)
      VALUES (p_club_id, p_table_ref, v_token, NULLIF(btrim(p_label), ''), v_uid)
      RETURNING id INTO v_id;
      RETURN jsonb_build_object('status', 'ok', 'token_id', v_id, 'token', v_token);
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 2 THEN RETURN jsonb_build_object('error', 'CONFLICT_RETRY'); END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('error', 'CONFLICT_RETRY');   -- unreachable; loop always returns
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_issue_table_qr_token(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_issue_table_qr_token(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fnb_revoke_table_qr_token(p_token_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.fnb_table_qr_tokens%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT * INTO v_row FROM public.fnb_table_qr_tokens WHERE id = p_token_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_row.club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF NOT v_row.is_active THEN RETURN jsonb_build_object('status', 'ok', 'idempotent', true); END IF;

  UPDATE public.fnb_table_qr_tokens
    SET is_active = false, revoked_by = v_uid, revoked_at = now()
    WHERE id = p_token_id;

  RETURN jsonb_build_object('status', 'ok', 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_revoke_table_qr_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_revoke_table_qr_token(uuid) TO authenticated;

-- List for the admin "QR bàn" tab: active tokens joined to table names (definer read of game_tables).
CREATE OR REPLACE FUNCTION public.fnb_list_table_qr_tokens(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'token_id',   t.id,
           'table_ref',  t.table_ref,
           'table_name', gt.table_name,
           'label',      t.label,
           'token',      t.token,
           'created_at', t.created_at)
           ORDER BY gt.table_name), '[]'::jsonb)
    INTO v_out
  FROM public.fnb_table_qr_tokens t
  LEFT JOIN public.game_tables gt ON gt.id = t.table_ref
  WHERE t.club_id = p_club_id AND t.is_active;

  RETURN jsonb_build_object('status', 'ok', 'tokens', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_list_table_qr_tokens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_list_table_qr_tokens(uuid) TO authenticated;

-- ===========================================================================================
-- Controlled-apply PROOF PLAN (BEGIN … ROLLBACK, after 000000..000016 + this):
--   -- (a) owner issues a token for a real table → {status:ok, token: 64 hex}:
--   SELECT public.fnb_issue_table_qr_token('<club>','<table>');
--   -- (b) issue AGAIN for the same table → old token deactivated, new returned (rotate):
--   SELECT public.fnb_issue_table_qr_token('<club>','<table>');
--   SELECT count(*) FROM fnb_table_qr_tokens WHERE table_ref='<table>' AND is_active;  -- EXPECT 1
--   -- (c) bad table → INVALID_TABLE_REF; non-owner caller → Forbidden.
--   -- (d) fnb_update_settings 7-arg: set guest_order_enabled=true → row updated; old 4-arg is GONE:
--   SELECT count(*) FROM pg_proc WHERE proname='fnb_update_settings';                  -- EXPECT 1
--   -- (e) TTL: a 'pending' bank_transfer order aged 1000s does NOT expire (1800s TTL);
--   --     a 'pending' cash order aged 1000s DOES expire (900s TTL).
--   -- (f) RLS: a cashier (non-owner) SELECT on fnb_table_qr_tokens returns 0 rows.
-- ROLLBACK;
--
-- Read-only VERIFY after apply:
--   SELECT column_name FROM information_schema.columns WHERE table_name='fnb_orders'
--     AND column_name IN ('payment_method','reference_code','qr_token_id','guest_seat'); -- 4 rows
--   SELECT indexname FROM pg_indexes WHERE tablename='fnb_table_qr_tokens';
--   SELECT has_function_privilege('anon','public.fnb_issue_table_qr_token(uuid,uuid,text)','EXECUTE'); -- f
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_list_table_qr_tokens(uuid);
--   DROP FUNCTION IF EXISTS public.fnb_revoke_table_qr_token(uuid);
--   DROP FUNCTION IF EXISTS public.fnb_issue_table_qr_token(uuid, uuid, text);
--   -- restore the …0007 fnb_expire_pending_orders body and the …0004 4-arg fnb_update_settings;
--   DROP TABLE IF EXISTS public.fnb_table_qr_tokens;
--   DROP INDEX IF EXISTS public.idx_fnb_orders_table_pending;   -- not dropped by any column below
--   ALTER TABLE public.fnb_settings DROP COLUMN IF EXISTS guest_bank_ttl_secs,
--     DROP COLUMN IF EXISTS guest_bank_auto_confirm, DROP COLUMN IF EXISTS guest_order_enabled;
--   ALTER TABLE public.fnb_orders DROP COLUMN IF EXISTS guest_seat, DROP COLUMN IF EXISTS qr_token_id,
--     DROP COLUMN IF EXISTS reference_code, DROP COLUMN IF EXISTS payment_method;
--   DROP TYPE IF EXISTS public.fnb_payment_method;
-- ===========================================================================================
