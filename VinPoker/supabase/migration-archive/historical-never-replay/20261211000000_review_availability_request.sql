-- ═══════════════════════════════════════════════════════════════════════════
-- Shift Planner V2 (E2): operator approve/reject of dealer availability requests (SOURCE-ONLY)
-- Date: 2026-12-11
--
-- WHY: V2's "Yêu cầu" panel lets the floor approve ("Duyệt & xếp vào ca") or reject a dealer's
--   shift/leave request from the dealer app. The status write (submitted → acknowledged|rejected)
--   currently goes through a direct UPDATE gated by the table's `_control_all` RLS — which blocks
--   operators who reach the planner via a CASHIER assignment (exactly the read gap #492 fixed with
--   get_dealer_availability_requests). This is the WRITE twin of that RPC: same server-side scope
--   (cashier_club_ids ∪ dealer_control_club_ids), so whoever can OPEN the planner for a club can
--   decide its requests — nothing more.
--
-- SECURITY: SECURITY DEFINER + search_path=public; auth.uid() required; club access verified
--   server-side (no IDOR); decision restricted to acknowledged|rejected (the table's own CHECK
--   also enforces the status domain). REVOKE PUBLIC/anon + GRANT authenticated.
--   Touches ONLY dealer_availability_requests — never attendance / swing / payroll / events.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive (new function).
--   Idempotent (CREATE OR REPLACE). Apply = owner-gated controlled op (SQL Editor / Management API).
--   Rollback: DROP FUNCTION public.review_availability_request(uuid, uuid, date, text);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.review_availability_request(
  p_club_id   uuid,
  p_dealer_id uuid,
  p_work_date date,
  p_decision  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_decision NOT IN ('acknowledged', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;

  -- Server-decided scope = caller's cashier ∪ dealer-control clubs (mirrors
  -- get_dealer_availability_requests / useOperatorClubs).
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT cid FROM public.cashier_club_ids(v_uid)        AS cid
      UNION
      SELECT cid FROM public.dealer_control_club_ids(v_uid) AS cid
    ) a
    WHERE cid = p_club_id
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  UPDATE public.dealer_availability_requests
     SET status = p_decision
   WHERE club_id   = p_club_id
     AND dealer_id = p_dealer_id
     AND work_date = p_work_date
     AND status    = 'submitted';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.review_availability_request(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_availability_request(uuid, uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.review_availability_request(uuid, uuid, date, text) IS
  'Shift Planner V2: approve/reject a dealer''s availability requests for one work date, scoped
   server-side to the caller''s cashier ∪ dealer-control clubs (write twin of
   get_dealer_availability_requests). Only submitted rows transition; returns {ok, updated}.';

COMMIT;
