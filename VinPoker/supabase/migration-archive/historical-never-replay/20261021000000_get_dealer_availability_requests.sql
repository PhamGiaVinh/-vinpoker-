-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: operator can't read dealer availability requests on the Shift Planner (SOURCE-ONLY)
-- Date: 2026-10-21
--
-- WHY: a dealer's "xin ca" request lands in dealer_availability_requests (confirmed live), but the
--   floor's Shift Planner reads 0 rows → "Chưa có yêu cầu". The table's RLS `_control_all` only allows
--   is_club_dealer_control / is_club_admin / super_admin. An operator who reaches the planner via a
--   CASHIER assignment (cashier_club_ids) — not owner/control/admin/super — is therefore blocked from
--   reading the requests (while the older `dealers` table, with broader RLS, still lists dealers — hence
--   "dealers show, requests empty"). The planner's own scope is cashier ∪ dealer-control (useOperatorClubs),
--   so the READ must match that.
--
-- FIX: a SECURITY DEFINER read RPC scoped server-side to cashier_club_ids ∪ dealer_control_club_ids of
--   the caller (same helpers useOperatorClubs uses), intersected with the requested club ids. Bypasses
--   the RLS gap safely — whoever can OPEN the planner for a club can READ its requests, nothing more.
--   Mirrors the canonical get_dealer_swing_health / get_club_finance_summary pattern.
--
-- SECURITY: SECURITY DEFINER + STABLE + search_path=public; auth.uid() required; inaccessible club ids
--   silently dropped (no IDOR). REVOKE PUBLIC/anon + GRANT authenticated. Read-only / zero writes.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive (new function;
--   touches no table/policy). Idempotent. Apply = owner-gated controlled op.
--   Rollback: docs/emergency_rollbacks/PRE_20261021_get_dealer_availability_requests.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dealer_availability_requests(
  p_club_ids  uuid[],
  p_work_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_scope  uuid[];
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Server-decided scope = the caller's cashier + dealer-control clubs (same as useOperatorClubs),
  -- intersected with the requested ids (inaccessible ids silently dropped → no IDOR).
  SELECT COALESCE(array_agg(DISTINCT cid), '{}')
    INTO v_scope
  FROM (
    SELECT cid FROM public.cashier_club_ids(v_uid)        AS cid
    UNION
    SELECT cid FROM public.dealer_control_club_ids(v_uid) AS cid
  ) a
  WHERE cid = ANY(COALESCE(p_club_ids, '{}'::uuid[]));

  IF v_scope IS NULL OR array_length(v_scope, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dealer_id',   r.dealer_id,
    'work_date',   r.work_date,
    'kind',        r.kind,
    'template_id', r.template_id,
    'note',        r.note,
    'status',      r.status
  )), '[]'::jsonb)
    INTO v_result
  FROM public.dealer_availability_requests r
  WHERE r.club_id = ANY(v_scope)
    AND r.work_date = p_work_date;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_availability_requests(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dealer_availability_requests(uuid[], date) TO authenticated;

COMMENT ON FUNCTION public.get_dealer_availability_requests(uuid[], date) IS
  'Shift Planner read of dealer_availability_requests, scoped server-side to the caller''s cashier ∪
   dealer-control clubs (bypasses the table _control_all RLS gap for cashier-access operators). Read-only.';

COMMIT;
