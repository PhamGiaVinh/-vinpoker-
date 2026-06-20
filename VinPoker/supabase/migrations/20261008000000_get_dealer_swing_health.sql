-- ═══════════════════════════════════════════════════════════════════════════
-- C2 — get_dealer_swing_health: read-only infra-health snapshot for the operator
-- console (SOURCE-ONLY; controlled apply later, owner-gated)
-- Date: 2026-10-08
--
-- WHY: the Dealer Swing console's live "Sức khoẻ sàn" strip shows FLOOR health
--   (coverage / overdue / on-break) but NOTHING about the swing ENGINE itself. After
--   B2 (lock fencing), we want the floor to SEE: is process-swing currently running
--   (and on which run/owner), is its lease healthy or stuck/overran, is the cron alive,
--   and is the Telegram pre-announce queue backing up. Those signals live in
--   service-role-internal tables (club_processing_locks, pre_announce_jobs) that the
--   operator's `authenticated` JWT cannot read directly (pre_announce_jobs has RLS on +
--   service_role-only grant). So C2 surfaces them via ONE read-only, access-scoped RPC.
--
-- SECURITY (mirrors the get_club_finance_summary pattern):
--   • SECURITY DEFINER + STABLE + search_path=public; auth.uid() required.
--   • Server-decided scope — NEVER trusts client club ids: the caller's accessible clubs =
--     cashier_club_ids(uid) ∪ dealer_control_club_ids(uid) (the same helpers the console's
--     useOperatorClubs hook uses). Requested ids are intersected with that set; inaccessible
--     ids are silently dropped (no IDOR, no error).
--   • REVOKE PUBLIC/anon; GRANT EXECUTE to authenticated only.
--   • Read-only / zero writes.
--
-- DATA returned (jsonb array, one object per accessible+requested club):
--   { club_id,
--     lock: { held, owner_id, locked_by, locked_at, expires_at, is_expired,
--             age_seconds, heartbeat_age_seconds } | { held:false },
--     pre_announce: { pending, processing, failed_recent },   -- failed within 6h
--     overdue_now,                                            -- assignments past swing_due_at
--     last_swing_activity_at }                                -- max(swing_processed_at): cron-liveness proxy
--
-- NOTE: there is NO persisted circuit-breaker state table — the breaker is runtime
--   threshold logic in process-swing; the observable signal is a HELD-but-EXPIRED lease
--   (lock.held && lock.is_expired = process-swing overran/crashed without releasing), which
--   this RPC exposes. last_swing_activity_at is a PROXY for cron liveness (no per-tick record
--   exists — A0a finding), labelled as such in the UI.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive
--   (CREATE OR REPLACE of a NEW name; no existing object touched). Idempotent. Apply is a
--   separate owner-gated controlled op. Rollback:
--   docs/emergency_rollbacks/PRE_20261008_get_dealer_swing_health.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dealer_swing_health(p_club_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_accessible uuid[];
  v_scope      uuid[];
  v_now        timestamptz := now();
  v_result     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Server-decided access: cashier + dealer-control clubs of the caller (never trust client).
  SELECT COALESCE(array_agg(DISTINCT cid), '{}')
    INTO v_accessible
  FROM (
    SELECT cid FROM public.cashier_club_ids(v_uid)        AS cid
    UNION
    SELECT cid FROM public.dealer_control_club_ids(v_uid) AS cid
  ) a;

  -- Intersect requested with accessible — silently drop inaccessible ids (no IDOR, no error).
  SELECT COALESCE(array_agg(x), '{}')
    INTO v_scope
  FROM unnest(COALESCE(p_club_ids, '{}'::uuid[])) AS x
  WHERE x = ANY(v_accessible);

  IF v_scope IS NULL OR array_length(v_scope, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(h ORDER BY (h->>'club_id')), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'club_id', cid,
      'lock', COALESCE(
        (
          SELECT jsonb_build_object(
            'held', true,
            'owner_id', l.owner_id,
            'locked_by', l.locked_by,
            'locked_at', l.locked_at,
            'expires_at', l.expires_at,
            'is_expired', (l.expires_at < v_now),
            'age_seconds', ROUND(EXTRACT(EPOCH FROM (v_now - l.locked_at)))::int,
            'heartbeat_age_seconds',
              CASE WHEN l.last_heartbeat_at IS NULL THEN NULL
                   ELSE ROUND(EXTRACT(EPOCH FROM (v_now - l.last_heartbeat_at)))::int END
          )
          FROM club_processing_locks l
          WHERE l.club_id = cid
        ),
        jsonb_build_object('held', false)
      ),
      'pre_announce', (
        SELECT jsonb_build_object(
          'pending',       COUNT(*) FILTER (WHERE status = 'pending'),
          'processing',    COUNT(*) FILTER (WHERE status = 'processing'),
          'failed_recent', COUNT(*) FILTER (WHERE status = 'failed' AND created_at > v_now - interval '6 hours')
        )
        FROM pre_announce_jobs
        WHERE club_id = cid
      ),
      'overdue_now', (
        SELECT COUNT(*)
        FROM dealer_assignments
        WHERE club_id = cid
          AND status = 'assigned'
          AND released_at IS NULL
          AND swing_due_at < v_now
      ),
      'last_swing_activity_at', (
        SELECT MAX(swing_processed_at)
        FROM dealer_assignments
        WHERE club_id = cid
          AND swing_processed_at IS NOT NULL
      )
    ) AS h
    FROM unnest(v_scope) AS t(cid)
  ) rows;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_swing_health(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dealer_swing_health(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_dealer_swing_health(uuid[]) IS
  'C2: read-only infra-health snapshot (lock/lease state, pre_announce queue, overdue, cron-liveness proxy)
   for the Dealer Swing operator console. Access-scoped to cashier_club_ids ∪ dealer_control_club_ids of
   auth.uid(); inaccessible ids silently dropped. service-role internal tables surfaced safely. Zero writes.';

COMMIT;
