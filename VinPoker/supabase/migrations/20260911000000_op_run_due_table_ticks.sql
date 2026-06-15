-- ============================================================================
-- 20260911000000_op_run_due_table_ticks.sql
--
-- GE-2K table runner — DB lister + dry-run diagnostic (source-only, NOT scheduled).
-- Implements the DB half of the GE-2H "table runner / auto-deal loop" spec
-- (docs/online-poker/GE2H_TABLE_RUNNER_AUTO_DEAL_SPEC.md). NO cron is created here
-- (forbidden in GE-2K); scheduling + the Edge deploy + the secret are Phase-D.
--
-- WHAT: two read-only, service-role, op_is_enabled-gated functions:
--   * op_run_due_table_ticks(p_limit) — returns the tables ELIGIBLE to deal the next
--     hand (open · no active hand · >=2 funded seated · inter-hand cooldown elapsed).
--     The Edge runner (online-poker-table-runner) runs the TS engine per table and calls
--     the existing op_start_hand. (A pure-SQL deal is impossible — shuffle/createHand are
--     the TS engine in the Deno Edge.)
--   * op_table_runner_diag(p_limit) — read-only classification of every OPEN table into
--     {eligible | active_hand | no_quorum | cooldown}, for the dry-run harness "why a
--     table is skipped" report. Never deals.
--
-- IDEMPOTENCY / RACE (the CAS guard, per the GE-2H spec §10/§11):
--   The HARD "never two hands per table" guarantee is the partial unique index on
--   online_poker_hands(table_id) WHERE status IN ('dealing','betting') — op_start_hand
--   returns 'already_active' if a hand already exists, so a duplicate deal is a no-op.
--   A DB advisory lock CANNOT span the deal (the deal runs in the Edge, outside any DB
--   transaction the lister could hold a lock across), so op_run_due_table_ticks takes only
--   a BEST-EFFORT xact-scoped pg_try_advisory_xact_lock over the already-LIMITed candidate
--   set to reduce duplicate work between overlapping cron ticks. The unique index is the
--   real guard. No persisted "tick attempt" marker is needed (and none is added).
--
-- FAIL-CLOSED: both functions return {outcome:'disabled', tables:[]} while
--   online_poker_config.enabled is false (the runtime is DARK), so they emit nothing and
--   the Edge runner no-ops. SECURITY DEFINER + search_path=public; EXECUTE granted to
--   service_role only (anon/authenticated/PUBLIC revoked), mirroring op_timeout_sweep.
--
-- SAFETY: runtime DARK; these never run in production yet. Pure additive source. NOT
--   applied by this PR. Slot 20260911000000 — DE-COLLIDED twice from parallel payroll
--   merges: 20260909000000 = Payroll P3 (#223), 20260910000000 = Payroll P4b (#226); this
--   is the next free slot after Payroll P4b. Live schema_migrations max is 20260820000002.
-- ============================================================================

BEGIN;

-- ── lister: tables eligible to deal the next hand ───────────────────────────
CREATE OR REPLACE FUNCTION public.op_run_due_table_ticks(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cooldown_secs constant int := 4;   -- inter-hand cooldown (let players see the result)
  v_tables jsonb;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled', 'tables', '[]'::jsonb);
  END IF;

  WITH candidates AS (
    SELECT t.id AS table_id, t.bb AS bb,
           lh.button_seat AS last_button_seat,
           COALESCE(lh.hand_no, 0) AS last_hand_no
    FROM public.online_poker_tables t
    LEFT JOIN LATERAL (
      SELECT h.hand_no, h.button_seat, h.updated_at
      FROM public.online_poker_hands h
      WHERE h.table_id = t.id
      ORDER BY h.hand_no DESC
      LIMIT 1
    ) lh ON true
    WHERE t.status = 'open'
      -- no active hand on this table
      AND NOT EXISTS (
        SELECT 1 FROM public.online_poker_hands h2
        WHERE h2.table_id = t.id AND h2.status IN ('dealing', 'betting')
      )
      -- inter-hand cooldown
      AND (lh.updated_at IS NULL OR lh.updated_at < now() - make_interval(secs => v_cooldown_secs))
      -- at least 2 funded seated players (stack > 0)
      AND (SELECT count(*) FROM public.online_poker_seats s
           WHERE s.table_id = t.id AND s.status = 'sitting' AND s.stack > 0) >= 2
    ORDER BY t.id
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', c.table_id,
           'bb', c.bb::text,
           'last_button_seat', c.last_button_seat,
           'last_hand_no', c.last_hand_no
         ) ORDER BY c.table_id), '[]'::jsonb)
  INTO v_tables
  FROM candidates c
  -- Best-effort per-table advisory lock (xact-scoped) over the already-LIMITed candidate
  -- set so overlapping cron ticks pick disjoint tables. This RELEASES when this function's
  -- transaction ends (before the Edge deals), so it cannot span the deal — the partial
  -- unique index on online_poker_hands is the HARD double-deal guard (op_start_hand →
  -- 'already_active'). Applied last so no table outside the result is ever locked.
  WHERE pg_try_advisory_xact_lock(hashtext('op_table_runner:' || c.table_id::text));

  RETURN jsonb_build_object('outcome', 'ok', 'tables', COALESCE(v_tables, '[]'::jsonb));
END;
$$;

-- ── dry-run diagnostic: classify every OPEN table (read-only, never deals) ───
CREATE OR REPLACE FUNCTION public.op_table_runner_diag(p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cooldown_secs constant int := 4;
  v_rows jsonb;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled', 'tables', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', sub.id,
           'bucket', CASE
             WHEN sub.has_active THEN 'active_hand'
             WHEN sub.funded < 2 THEN 'no_quorum'
             WHEN sub.last_upd IS NOT NULL
                  AND sub.last_upd >= now() - make_interval(secs => v_cooldown_secs) THEN 'cooldown'
             ELSE 'eligible' END,
           'funded', sub.funded,
           'has_active_hand', sub.has_active
         ) ORDER BY sub.id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT t.id,
      EXISTS (SELECT 1 FROM public.online_poker_hands h
              WHERE h.table_id = t.id AND h.status IN ('dealing', 'betting')) AS has_active,
      (SELECT count(*) FROM public.online_poker_seats s
       WHERE s.table_id = t.id AND s.status = 'sitting' AND s.stack > 0) AS funded,
      (SELECT max(h.updated_at) FROM public.online_poker_hands h WHERE h.table_id = t.id) AS last_upd
    FROM public.online_poker_tables t
    WHERE t.status = 'open'
    ORDER BY t.id
    LIMIT GREATEST(p_limit, 0)
  ) sub;

  RETURN jsonb_build_object('outcome', 'ok', 'tables', v_rows);
END;
$$;

-- Service-role-only EXECUTE (mirrors op_timeout_sweep; the Edge runner uses service role).
REVOKE EXECUTE ON FUNCTION public.op_run_due_table_ticks(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_run_due_table_ticks(int) TO service_role;
REVOKE EXECUTE ON FUNCTION public.op_table_runner_diag(int)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_table_runner_diag(int)   TO service_role;

COMMIT;
