-- F&B GQR-M2 — Guest QR table-ordering: the ANON RPC surface. DEPENDS ON 000017 (tokens/columns/
-- settings), 000014 (create body cloned here), 000002 (menu tables). SOURCE-ONLY.
--
-- Apply AFTER …0017, controlled session, owner-gated. NOT `db push` / not deploy_db.
--
-- WHY: guests are anonymous (no VBacker account). Today EVERY fnb_* read/RPC revokes anon, so a
--   guest can do nothing. This migration adds exactly THREE SECURITY DEFINER functions granted to
--   anon — the entire new anonymous surface. Every fact (club, table, menu) derives from the SECRET
--   per-table token row; a client-supplied club_id is never trusted. Proven stack pattern for
--   anon SECURITY DEFINER RPCs: get_tournament_leaderboard (20261024000000), tv_pair_begin
--   (20260818000001), get_invite_preview.
--
-- LEAKED-TOKEN BLAST RADIUS (by design): read ONE table's menu; create ≤5 concurrent PENDING
--   orders on that table (rate-limited 10/10min, auto-expiring via the …0017 TTL sweep, and a
--   PENDING order moves ZERO stock and ZERO money — the prepaid model moves both only at PAID);
--   read the status of orders created with that token. Nothing else. Kill switches: rotate the
--   token (instant), per-club fnb_settings.guest_order_enabled=false, FE flag fnbGuestOrder.
--
-- ROLLBACK: bottom of file.

-- index supporting the per-token rate cap in fnb_guest_create_order.
CREATE INDEX IF NOT EXISTS idx_fnb_orders_qr_token
  ON public.fnb_orders (qr_token_id, created_at) WHERE qr_token_id IS NOT NULL;

-- ===========================================================================================
-- 1. fnb_guest_lookup — token → "you are at Bàn X" + the club's active menu + payment options.
--    STABLE read; returns NO uuids beyond menu/category ids (needed for ordering).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_guest_lookup(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok        public.fnb_table_qr_tokens%ROWTYPE;
  v_enabled    boolean;
  v_bank_ok    boolean;
  v_club_name  text;
  v_table_name text;
  v_cats       jsonb;
  v_items      jsonb;
BEGIN
  SELECT * INTO v_tok FROM public.fnb_table_qr_tokens
    WHERE token = p_token AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TOKEN_INVALID'); END IF;

  SELECT COALESCE(s.guest_order_enabled, false) INTO v_enabled
    FROM public.fnb_settings s WHERE s.club_id = v_tok.club_id;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('error', 'GUEST_ORDER_DISABLED');
  END IF;

  SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id = v_tok.club_id;
  SELECT gt.table_name INTO v_table_name FROM public.game_tables gt WHERE gt.id = v_tok.table_ref;

  -- bank option available only when the club has an active escrow account to receive transfers.
  SELECT EXISTS (
    SELECT 1 FROM public.platform_bank_accounts pba
    WHERE pba.club_id = v_tok.club_id AND pba.is_active AND pba.account_type = 'escrow'
  ) INTO v_bank_ok;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sort_order', c.sort_order)
           ORDER BY c.sort_order, c.name), '[]'::jsonb)
    INTO v_cats
  FROM public.fnb_categories c
  WHERE c.club_id = v_tok.club_id AND c.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'category_id', m.category_id, 'name', m.name,
           'price_vnd', m.price_vnd, 'image_url', m.image_url, 'sort_order', m.sort_order)
           ORDER BY m.sort_order, m.name), '[]'::jsonb)
    INTO v_items
  FROM public.fnb_menu_items m
  WHERE m.club_id = v_tok.club_id AND m.is_active;

  RETURN jsonb_build_object(
    'status',         'ok',
    'club_name',      v_club_name,
    'table_name',     COALESCE(v_table_name, v_tok.label, 'Bàn'),
    'bank_available', COALESCE(v_bank_ok, false),
    'categories',     v_cats,
    'items',          v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_guest_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fnb_guest_lookup(text) TO anon, authenticated;

-- ===========================================================================================
-- 2. fnb_guest_create_order — the guest's only write. Clone of the …0014 create body with the
--    staff authz replaced by token authz + abuse guards (checked IN ORDER before any insert):
--      (1) token active + club guest_order_enabled;
--      (2) payment method valid; 'bank_transfer' additionally needs an active escrow account;
--      (3) shape caps: ≤30 lines, qty ≤20/line, name ≤60, note ≤200, seat 1..20 or NULL;
--      (4) pending cap: ≥5 pending orders on this TABLE → TABLE_PENDING_LIMIT;
--      (5) rate cap: ≥10 orders from this TOKEN in 10 min → RATE_LIMITED;
--    Amount is ALWAYS server-computed from the club's active menu (client prices ignored).
--    Bank orders mint a globally-unique 'FNB-'||8hex reference_code (REENTRY retry-loop precedent,
--    20260901000001) and return the bank details for the VietQR screen (read inside the definer —
--    anon cannot read platform_bank_accounts directly).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_guest_create_order(
  p_token             text,
  p_seat              smallint DEFAULT NULL,
  p_customer_name     text     DEFAULT NULL,
  p_note              text     DEFAULT NULL,
  p_lines             jsonb    DEFAULT '[]'::jsonb,
  p_payment_method    text     DEFAULT 'cash',
  p_client_request_id text     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok       public.fnb_table_qr_tokens%ROWTYPE;
  v_enabled   boolean;
  v_bank      record;
  v_bank_json jsonb := NULL;   -- built ONLY in the bank branch; RETURN references THIS, never v_bank
                               -- (an unassigned plain `record` field ref raises 55000 even in a
                               --  not-taken CASE arm — plan-time type resolution; review finding).
  v_crid      text;
  v_order_id  uuid;
  v_subtotal  bigint := 0;
  v_line      jsonb;
  v_qty       int;
  v_mi        record;
  v_ref       text;
  v_ttl_bank  int;
  v_ttl_cash  int;
  v_ttl       int;
  v_existing  public.fnb_orders%ROWTYPE;
  v_attempt   int := 0;
BEGIN
  -- (1) token + club switch. FOR UPDATE serializes concurrent creates PER TABLE (one active token
  --     per table, …0017) so the pending/rate caps below are race-proof, not just advisory.
  SELECT * INTO v_tok FROM public.fnb_table_qr_tokens
    WHERE token = p_token AND is_active
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TOKEN_INVALID'); END IF;
  SELECT COALESCE(s.guest_order_enabled, false),
         COALESCE(s.guest_bank_ttl_secs, 1800),
         COALESCE(s.pending_ttl_secs, 900)
    INTO v_enabled, v_ttl_bank, v_ttl_cash
    FROM public.fnb_settings s WHERE s.club_id = v_tok.club_id;
  IF NOT COALESCE(v_enabled, false) THEN RETURN jsonb_build_object('error', 'GUEST_ORDER_DISABLED'); END IF;

  -- (2) payment method. The TTL shown to the guest MUST match the …0017 sweep's per-method CASE.
  IF p_payment_method NOT IN ('cash', 'bank_transfer') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'payment_method');
  END IF;
  v_ttl := CASE WHEN p_payment_method = 'bank_transfer' THEN COALESCE(v_ttl_bank, 1800)
                ELSE COALESCE(v_ttl_cash, 900) END;
  IF p_payment_method = 'bank_transfer' THEN
    SELECT pba.bank_name, pba.bank_bin, pba.account_number, pba.account_holder, pba.qr_code_url
      INTO v_bank
      FROM public.platform_bank_accounts pba
      WHERE pba.club_id = v_tok.club_id AND pba.is_active AND pba.account_type = 'escrow'
      ORDER BY pba.created_at ASC          -- OLDEST = the row the owner's picker edits (house convention)
      LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'BANK_UNAVAILABLE'); END IF;
    v_bank_json := jsonb_build_object(
      'bank_name', v_bank.bank_name, 'bank_bin', v_bank.bank_bin,
      'account_number', v_bank.account_number, 'account_holder', v_bank.account_holder,
      'qr_code_url', v_bank.qr_code_url);
  END IF;

  -- (3) shape caps — reject absurd payloads before touching anything.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'empty lines');
  END IF;
  IF jsonb_array_length(p_lines) > 30 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'too many lines');
  END IF;
  IF p_seat IS NOT NULL AND (p_seat < 1 OR p_seat > 20) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'seat');
  END IF;

  -- (4) pending cap per TABLE (uses idx_fnb_orders_table_pending).
  IF (SELECT count(*) FROM public.fnb_orders o
      WHERE o.club_id = v_tok.club_id AND o.table_ref = v_tok.table_ref AND o.status = 'pending') >= 5 THEN
    RETURN jsonb_build_object('error', 'TABLE_PENDING_LIMIT');
  END IF;

  -- (5) rate cap per TOKEN (uses idx_fnb_orders_qr_token).
  IF (SELECT count(*) FROM public.fnb_orders o
      WHERE o.qr_token_id = v_tok.id AND o.created_at > now() - interval '10 minutes') >= 10 THEN
    RETURN jsonb_build_object('error', 'RATE_LIMITED');
  END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- idempotency: a retry with the same crid returns the existing order (incl. its bank payload).
  BEGIN
    INSERT INTO public.fnb_orders
      (club_id, status, source, table_label, customer_name, note,
       table_ref, qr_token_id, guest_seat, payment_method, client_request_id, created_by)
    VALUES
      (v_tok.club_id, 'pending', 'table', NULL,
       left(NULLIF(btrim(p_customer_name), ''), 60),
       left(NULLIF(btrim(p_note), ''), 200),
       v_tok.table_ref, v_tok.id, p_seat, p_payment_method::public.fnb_payment_method,
       v_crid, NULL)                                   -- created_by NULL = anonymous guest
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- idempotency is scoped to THIS token: a crid collision with an order from another table /
    -- the staff counter must NOT leak that order (review finding) — reject instead.
    SELECT * INTO v_existing FROM public.fnb_orders
      WHERE club_id = v_tok.club_id AND client_request_id = v_crid AND qr_token_id = v_tok.id;
    IF v_existing.id IS NULL THEN
      RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'client_request_id conflict');
    END IF;
    RETURN jsonb_build_object(
      'status', 'ok', 'order_id', v_existing.id, 'idempotent', true,
      'subtotal_vnd', v_existing.subtotal_vnd,
      'payment_method', v_existing.payment_method,
      'reference_code', v_existing.reference_code,
      'expires_at', v_existing.created_at + ((CASE WHEN v_existing.payment_method = 'bank_transfer'
                       THEN COALESCE(v_ttl_bank, 1800) ELSE COALESCE(v_ttl_cash, 900) END) * interval '1 second'),
      'bank', v_bank_json);   -- NULL for cash; the escrow row was already fetched for a bank retry
  END;

  -- lines: validate against this club's ACTIVE menu; snapshot price + sum subtotal SERVER-SIDE
  -- (clone of …0014; a RAISE aborts the tx → the pending order above is rolled back too).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line->>'qty')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    IF v_qty > 20 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    SELECT id, name, price_vnd, is_active INTO v_mi
      FROM public.fnb_menu_items WHERE id = (v_line->>'menu_item_id')::uuid AND club_id = v_tok.club_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND %', (v_line->>'menu_item_id'); END IF;
    IF NOT v_mi.is_active THEN RAISE EXCEPTION 'MENU_ITEM_INACTIVE %', v_mi.name; END IF;

    INSERT INTO public.fnb_order_items (order_id, club_id, menu_item_id, name_snapshot, qty, unit_price_snapshot, line_status)
    VALUES (v_order_id, v_tok.club_id, v_mi.id, v_mi.name, v_qty, v_mi.price_vnd, 'pending')
    ON CONFLICT (order_id, menu_item_id) DO UPDATE SET qty = public.fnb_order_items.qty + EXCLUDED.qty;

    v_subtotal := v_subtotal + v_mi.price_vnd * v_qty;
  END LOOP;

  -- bank orders: mint the globally-unique FNB-{8hex} memo (unique-violation retry, REENTRY idiom).
  IF p_payment_method = 'bank_transfer' THEN
    LOOP
      v_attempt := v_attempt + 1;
      v_ref := 'FNB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      BEGIN
        UPDATE public.fnb_orders SET reference_code = v_ref WHERE id = v_order_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 5 THEN RAISE; END IF;
      END;
    END LOOP;
  END IF;

  UPDATE public.fnb_orders SET subtotal_vnd = v_subtotal, updated_at = now() WHERE id = v_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, new_status, actor, metadata)
  VALUES (v_order_id, v_tok.club_id, 'created', 'pending', NULL,
          jsonb_build_object('via', 'guest_qr', 'token_id', v_tok.id, 'seat', p_seat,
                             'payment_method', p_payment_method));

  RETURN jsonb_build_object(
    'status', 'ok', 'order_id', v_order_id, 'idempotent', false,
    'subtotal_vnd', v_subtotal,
    'payment_method', p_payment_method,
    'reference_code', v_ref,
    'expires_at', now() + (v_ttl * interval '1 second'),
    'bank', v_bank_json                    -- NULL for cash (never dereferences v_bank — see DECLARE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_guest_create_order(text, smallint, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fnb_guest_create_order(text, smallint, text, text, jsonb, text, text) TO anon, authenticated;

-- ===========================================================================================
-- 3. fnb_guest_order_status — the guest's poll target (pending → paid → shipped | expired |
--    cancelled). BOTH keys required (token + order created WITH that token) → no cross-table
--    probing. The token is accepted even if since revoked, so a mid-payment guest survives a
--    rotation. Re-returns the bank payload for bank+pending orders (localStorage resume).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_guest_order_status(p_token text, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok       public.fnb_table_qr_tokens%ROWTYPE;
  v_ord       public.fnb_orders%ROWTYPE;
  v_bank      record;
  v_bank_json jsonb := NULL;   -- built ONLY inside the IF; RETURN references THIS, never v_bank
                               -- (unassigned plain-record field refs raise 55000 — review finding).
  v_ttl_bank  int;
  v_ttl_cash  int;
  v_ttl       int;
BEGIN
  SELECT * INTO v_tok FROM public.fnb_table_qr_tokens WHERE token = p_token;  -- revoked OK (see header)
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TOKEN_INVALID'); END IF;

  SELECT * INTO v_ord FROM public.fnb_orders WHERE id = p_order_id AND qr_token_id = v_tok.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  SELECT COALESCE(s.guest_bank_ttl_secs, 1800), COALESCE(s.pending_ttl_secs, 900)
    INTO v_ttl_bank, v_ttl_cash
    FROM public.fnb_settings s WHERE s.club_id = v_ord.club_id;
  -- expires_at must mirror the …0017 sweep's per-method CASE (cash 900s vs bank 1800s defaults).
  v_ttl := CASE WHEN v_ord.payment_method = 'bank_transfer' THEN COALESCE(v_ttl_bank, 1800)
                ELSE COALESCE(v_ttl_cash, 900) END;

  IF v_ord.payment_method = 'bank_transfer' AND v_ord.status = 'pending' THEN
    SELECT pba.bank_name, pba.bank_bin, pba.account_number, pba.account_holder, pba.qr_code_url
      INTO v_bank
      FROM public.platform_bank_accounts pba
      WHERE pba.club_id = v_ord.club_id AND pba.is_active AND pba.account_type = 'escrow'
      ORDER BY pba.created_at ASC LIMIT 1;
    IF FOUND THEN
      v_bank_json := jsonb_build_object(
        'bank_name', v_bank.bank_name, 'bank_bin', v_bank.bank_bin,
        'account_number', v_bank.account_number, 'account_holder', v_bank.account_holder,
        'qr_code_url', v_bank.qr_code_url);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'order', jsonb_build_object(
      'id', v_ord.id, 'order_status', v_ord.status, 'subtotal_vnd', v_ord.subtotal_vnd,
      'payment_method', v_ord.payment_method, 'reference_code', v_ord.reference_code,
      'guest_seat', v_ord.guest_seat, 'created_at', v_ord.created_at, 'paid_at', v_ord.paid_at,
      'expires_at', v_ord.created_at + (v_ttl * interval '1 second')),
    'bank', v_bank_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_guest_order_status(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fnb_guest_order_status(text, uuid) TO anon, authenticated;

-- ===========================================================================================
-- Controlled-apply PROOF PLAN (BEGIN … ROLLBACK, after …0017 + this; fixture club with an active
-- menu item <M>, guest_order_enabled=true, an issued token <T>):
--   RESET ROLE; SET LOCAL ROLE anon;                       -- simulate an anonymous caller
--   -- (a) lookup happy path → club/table names + menu + bank_available:
--   SELECT public.fnb_guest_lookup('<T>');
--   -- (b) bad token → TOKEN_INVALID; guest_order_enabled=false → GUEST_ORDER_DISABLED.
--   -- (c) cash order → {status:ok, order_id, subtotal>0}; row has source='table', created_by NULL,
--   --     qr_token_id set, table_ref = the token's table, payment_method='cash'.
--   SELECT public.fnb_guest_create_order('<T>', 3, 'Anh A', NULL,
--     '[{"menu_item_id":"<M>","qty":2}]', 'cash', 'g1');
--   -- (d) same crid retry → idempotent:true, same order_id.
--   -- (e) bank order → reference_code 'FNB-XXXXXXXX' + bank{} payload + expires_at ≈ now()+1800s.
--   -- (f) 6th pending order on the table → TABLE_PENDING_LIMIT; 11th in 10min → RATE_LIMITED.
--   -- (g) qty 25 → INVALID_QTY raise; unknown menu id → MENU_ITEM_NOT_FOUND raise (tx aborted).
--   -- (h) status poll with the right token → order json; with a DIFFERENT table's token →
--   --     ORDER_NOT_FOUND (no cross-table probing).
--   -- (h2) poll a CASH order AND a PAID/EXPIRED bank order → clean order json each time
--   --      (regression guard for the unassigned-record 55000 bug caught in review); a cash order's
--   --      expires_at reflects pending_ttl_secs (900), a bank order's guest_bank_ttl_secs (1800).
--   -- (h3) a crid that collides with an order NOT created by this token →
--   --      {error:'INVALID_INPUT', detail:'client_request_id conflict'} (no data returned).
--   -- (i) anon CANNOT touch anything else:
--   SELECT count(*) FROM public.fnb_menu_items;            -- EXPECT permission denied / 0 rows
--   SELECT public.fnb_create_order(...);                   -- EXPECT permission denied for function
-- ROLLBACK;
--
-- Read-only VERIFY after apply:
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND proname LIKE 'fnb_guest%';                          -- exactly 3
--   SELECT has_function_privilege('anon','public.fnb_guest_lookup(text)','EXECUTE');  -- t
--   SELECT has_function_privilege('anon','public.fnb_create_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,uuid,uuid)','EXECUTE'); -- f
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_guest_order_status(text, uuid);
--   DROP FUNCTION IF EXISTS public.fnb_guest_create_order(text, smallint, text, text, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.fnb_guest_lookup(text);
--   DROP INDEX IF EXISTS public.idx_fnb_orders_qr_token;
-- ===========================================================================================
