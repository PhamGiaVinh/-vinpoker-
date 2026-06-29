-- F&B module (FNB-F3-pre) — stocktake session WRITE RPCs. DEPENDS ON 000002 (fnb_stocktakes/_lines)
-- + 000003 (fnb_commit_stocktake already live). NEW money/stock-ADJACENT writers → reviewed at P3 rigor.
--
-- SOURCE-ONLY. Apply in a controlled session (Supabase SQL Editor / Management API), owner-gated, AFTER
-- owner review. NOT `db push` / not deploy_db. schema_migrations untouched. Number 20261111000009 is FREE
-- on origin/main (confirmed 2026-06-28: main advanced to 20261117 SePay; NO 20261111* on main).
--
-- WHY: the applied set has `fnb_commit_stocktake` (live) but NO way to CREATE a count session or ENTER
-- counted lines from the client (fnb_* tables are SELECT-only). These two writers fill that gap so the
-- StocktakeBoard UI (F3) can: open a session → enter counted quantities → commit.
--
-- THE 5 GUARANTEES (owner-specified, P3-level):
--   (1) BOTH RPCs are OWNER-ONLY (`is_club_owner`) — stocktake is an admin task, NOT a cashier task (§7).
--   (2) `fnb_set_stocktake_line` GUARDS `status='open'` (locks the header FOR UPDATE) → a committed
--       session's lines can never be edited.
--   (3) `fnb_open_stocktake` is IDEMPOTENT and prevents DUPLICATE PARALLEL open sessions per club:
--       (a) a retry with the same client_request_id returns the same session; (b) a DB partial-unique
--       index `uq_fnb_stocktake_one_open` enforces AT MOST ONE open session per club race-safely → a
--       concurrent/existing open session makes the INSERT conflict and we return that open session.
--   (4) NEITHER RPC TOUCHES `fnb_ingredients.on_hand` / `avg_unit_cost` / `version` — they only write
--       `fnb_stocktakes` + `fnb_stocktake_lines.counted_qty`. The on_hand delta is applied ONLY by the
--       already-live, already-reviewed `fnb_commit_stocktake` (which recomputes delta under lock at commit).
--   (5) SECURITY DEFINER + `search_path=public` + REVOKE PUBLIC/anon + GRANT authenticated + explicit
--       auth.uid() check inside (same posture as P3).

-- ===========================================================================================
-- 0. DB backstop for (3): at most ONE open session per club (race-safe, enforced regardless of code).
--    Safe to create: no stocktake sessions exist yet (no writer until now), so no duplicate to conflict.
-- ===========================================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_stocktake_one_open
  ON public.fnb_stocktakes (club_id) WHERE status = 'open';

-- ===========================================================================================
-- 1. fnb_open_stocktake — owner-only; idempotent; one open session per club. Touches NO inventory.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_open_stocktake(
  p_club_id           uuid,
  p_note              text DEFAULT NULL,
  p_client_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_crid text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  -- (1) owner-only — stocktake is an admin task, not a cashier task.
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  v_crid := COALESCE(NULLIF(btrim(p_client_request_id), ''), gen_random_uuid()::text);

  -- (3a) client_request_id idempotency: a retry returns the same session, never a second one.
  SELECT id INTO v_id FROM public.fnb_stocktakes WHERE club_id = p_club_id AND client_request_id = v_crid;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'stocktake_id', v_id, 'idempotent', true);
  END IF;

  -- (3b) at most ONE open session per club (uq_fnb_stocktake_one_open). A concurrent/existing open
  --      session makes this INSERT conflict → return that open session instead of creating a duplicate.
  BEGIN
    INSERT INTO public.fnb_stocktakes (club_id, note, status, created_by, client_request_id)
    VALUES (p_club_id, p_note, 'open', v_uid, v_crid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.fnb_stocktakes WHERE club_id = p_club_id AND status = 'open' LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.fnb_stocktakes WHERE club_id = p_club_id AND client_request_id = v_crid;
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'stocktake_id', v_id, 'idempotent', true);
  END;

  -- (4) opening a session writes ONLY fnb_stocktakes — it does NOT touch fnb_ingredients at all.
  RETURN jsonb_build_object('status', 'ok', 'stocktake_id', v_id, 'idempotent', false);
END;
$$;

-- ===========================================================================================
-- 2. fnb_set_stocktake_line — owner-only; only on an OPEN session; sets ONLY counted_qty. No inventory.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_set_stocktake_line(
  p_stocktake_id  uuid,
  p_ingredient_id uuid,
  p_counted_qty   numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  -- Lock the session header so a concurrent fnb_commit_stocktake (which also FOR UPDATEs it) cannot
  -- race a new line in mid-commit.
  SELECT club_id, status INTO v_club, v_status
  FROM public.fnb_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'STOCKTAKE_NOT_FOUND'); END IF;

  -- (1) owner-only
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  -- (2) only an OPEN session can be edited — a committed session is immutable.
  IF v_status <> 'open' THEN RETURN jsonb_build_object('error', 'BAD_STATE', 'status', v_status); END IF;
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'counted_qty');
  END IF;
  -- ingredient must belong to the same club (read-only existence check — no write to fnb_ingredients).
  IF NOT EXISTS (SELECT 1 FROM public.fnb_ingredients WHERE id = p_ingredient_id AND club_id = v_club) THEN
    RETURN jsonb_build_object('error', 'INGREDIENT_NOT_FOUND');
  END IF;

  -- (4) sets ONLY counted_qty on the line. expected_qty / delta_applied (and the on_hand delta) are
  --     computed & applied LATER by fnb_commit_stocktake — this RPC NEVER touches on_hand/avg_unit_cost.
  INSERT INTO public.fnb_stocktake_lines (stocktake_id, club_id, ingredient_id, counted_qty)
  VALUES (p_stocktake_id, v_club, p_ingredient_id, p_counted_qty)
  ON CONFLICT (stocktake_id, ingredient_id) DO UPDATE SET counted_qty = EXCLUDED.counted_qty;

  RETURN jsonb_build_object('status', 'ok', 'stocktake_id', p_stocktake_id,
                            'ingredient_id', p_ingredient_id, 'counted_qty', p_counted_qty);
END;
$$;

-- ===========================================================================================
-- 3. Grants
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.fnb_open_stocktake(uuid, text, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fnb_set_stocktake_line(uuid, uuid, numeric)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_open_stocktake(uuid, text, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_set_stocktake_line(uuid, uuid, numeric) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (after 000002+000003; run in a tx + ROLLBACK).
--   <owner> owns <club>; <cashier> has cashier facet only; <I> is an ingredient of <club> with on_hand=H.
--
-- BEGIN;
--   -- (1) cashier cannot open a session:
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_open_stocktake('<club>', 'thử');     -- Forbidden
--   -- owner opens; (3a) a retry with same crid returns the SAME id:
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.fnb_open_stocktake('<club>', NULL, 'ck1');   -- {stocktake_id: S, idempotent:false}
--   SELECT public.fnb_open_stocktake('<club>', NULL, 'ck1');   -- {stocktake_id: S, idempotent:true}
--   -- (3b) a DIFFERENT crid while S is still open returns S (one open per club), not a new session:
--   SELECT public.fnb_open_stocktake('<club>', NULL, 'ck2');   -- {stocktake_id: S, idempotent:true}
--   -- (2)+(4) set a line on the OPEN session; on_hand/avg UNCHANGED:
--   SELECT public.fnb_set_stocktake_line('<S>', '<I>', 7);     -- ok, counted_qty=7
--   SELECT on_hand, avg_unit_cost FROM public.fnb_ingredients WHERE id='<I>';   -- STILL H / unchanged
--   -- (1) cashier cannot set a line:
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_set_stocktake_line('<S>','<I>',9);   -- Forbidden
--   -- (2) after commit the session is closed → cannot edit its lines:
--   SET LOCAL request.jwt.claim.sub = '<owner>'; SELECT public.fnb_commit_stocktake('<S>');               -- applies delta (live RPC)
--   SELECT public.fnb_set_stocktake_line('<S>', '<I>', 5);     -- {error: BAD_STATE, status: committed}
--   -- now a new open session can be created (S is committed, not open):
--   SELECT public.fnb_open_stocktake('<club>', NULL, 'ck3');   -- new id, idempotent:false
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_set_stocktake_line(uuid, uuid, numeric);
--   DROP FUNCTION IF EXISTS public.fnb_open_stocktake(uuid, text, text);
--   DROP INDEX IF EXISTS public.uq_fnb_stocktake_one_open;
-- ===========================================================================================
