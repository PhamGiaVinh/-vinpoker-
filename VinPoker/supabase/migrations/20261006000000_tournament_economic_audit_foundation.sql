-- GTD Phase 3b-A — Tournament Economic Fields Audit Foundation.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not
-- deploy_db), then run the test plan below and regen types.ts in a separate step.
--
-- WHY: tournaments are edited via a direct `from('tournaments').update(...)` path and
-- there is NO audit on tournament edits today. This builds a DB-level trail so EVERY
-- change to a tournament's economic fields is recorded regardless of which client/path
-- made it — the trigger guarantees coverage even if a future write path bypasses the UI.
--
-- SCOPE (per docs/club-intelligence/GTD_TWO_PART_SPEC.md + owner decision):
--   * Audit foundation only. NO Floor input UI (that is Phase 3b-D), NO overlay
--     (Phase 3c), NO Series Intelligence change, NO prize_pool real-time work.
--   * AFTER UPDATE on public.tournaments only (edits). Inserts/deletes are out of scope.
--
-- AUDITED ECONOMIC COLUMNS (only columns that actually exist on public.tournaments):
--   guarantee_amount, buy_in, rake_amount, service_fee_amount, prize_pool,
--   starting_stack, minutes_per_level.
-- NOTE: auditing a `prize_pool` EDIT is NOT the same as "prize_pool real-time confirmed".
--   This logs only when the column is UPDATED; it does not prove cashier/buy-in updates
--   prize_pool live. Real-time prize-pool / live overlay remains a Phase 3c concern.
-- Intentionally NOT audited because the column does not exist on tournaments:
--   entry_fee/"fee" (the fee column IS rake_amount, which is audited),
--   max_players / capacity (no such column). Document as future schema work if needed.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS, so a future
-- gated `db push` is a safe no-op if already applied. schema_migrations is NOT touched
-- by the controlled apply.

-- ---------------------------------------------------------------------------
-- 1. Audit table (shape mirrors the club_intel_audit_log / payroll_audit_log precedent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_economic_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL,
  tournament_id   uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  changed_by      uuid DEFAULT auth.uid(),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'tournaments_update_trigger',
  changed_fields  jsonb NOT NULL,   -- array of changed economic field names
  old_values      jsonb NOT NULL,   -- { field: old_value } for changed fields only
  new_values      jsonb NOT NULL,   -- { field: new_value } for changed fields only
  reason          text              -- optional; not forced by this PR
);

CREATE INDEX IF NOT EXISTS idx_tea_audit_club ON public.tournament_economic_audit_log(club_id);
CREATE INDEX IF NOT EXISTS idx_tea_audit_tournament ON public.tournament_economic_audit_log(tournament_id, changed_at DESC);

COMMENT ON TABLE public.tournament_economic_audit_log IS
  'Change trail for tournament economic fields (guarantee_amount/buy_in/rake_amount/service_fee_amount/prize_pool/starting_stack/minutes_per_level). Written only by the AFTER UPDATE trigger via SECURITY DEFINER; no direct client writes (default-deny RLS).';

-- ---------------------------------------------------------------------------
-- 2. Trigger function — logs only when an audited economic field actually changed.
--    Uses IS DISTINCT FROM (NOT <>) so NULL->value and value->NULL are detected;
--    same value does not log. One row per qualifying UPDATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_tournament_economic_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ONLY columns that exist on public.tournaments (verified against the schema).
  v_cols    text[] := ARRAY[
    'guarantee_amount', 'buy_in', 'rake_amount', 'service_fee_amount',
    'prize_pool', 'starting_stack', 'minutes_per_level'
  ];
  v_col     text;
  v_oldj    jsonb := to_jsonb(OLD);
  v_newj    jsonb := to_jsonb(NEW);
  v_changed text[] := ARRAY[]::text[];
  v_old     jsonb := '{}'::jsonb;
  v_new     jsonb := '{}'::jsonb;
  v_actor   uuid;
BEGIN
  FOREACH v_col IN ARRAY v_cols LOOP
    -- jsonb extract with IS DISTINCT FROM correctly handles NULL<->value transitions.
    IF (v_oldj -> v_col) IS DISTINCT FROM (v_newj -> v_col) THEN
      v_changed := array_append(v_changed, v_col);
      v_old := v_old || jsonb_build_object(v_col, v_oldj -> v_col);
      v_new := v_new || jsonb_build_object(v_col, v_newj -> v_col);
    END IF;
  END LOOP;

  -- No audited economic field changed → do nothing.
  IF array_length(v_changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Real acting user from the request JWT (works inside SECURITY DEFINER); NULL-safe.
  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;

  INSERT INTO public.tournament_economic_audit_log
    (club_id, tournament_id, changed_by, source, changed_fields, old_values, new_values)
  VALUES (
    NEW.club_id,
    NEW.id,
    v_actor,
    'tournaments_update_trigger',
    to_jsonb(v_changed),
    v_old,
    v_new
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_tournament_economic_changes() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_tournament_economic_audit ON public.tournaments;
CREATE TRIGGER trg_tournament_economic_audit
  AFTER UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tournament_economic_changes();

-- ---------------------------------------------------------------------------
-- 3. RLS — club-scoped SELECT only. NO client INSERT/UPDATE/DELETE policy
--    (default deny). The trigger writes via SECURITY DEFINER, which bypasses RLS.
--    Economic audit history is SENSITIVE — read is restricted to club OWNER +
--    super_admin only, via core helpers (has_role + is_club_owner; no dependency on
--    F1's is_club_member_or_owner). `club_members` is intentionally NOT granted read: it may
--    include ordinary players/members, which would leak the full economic-edit
--    history. TODO: Floor/cashier audit read access is intentionally deferred until
--    the exact role table/helper (e.g. `club_cashiers`) is confirmed — add it in
--    Phase 3b-D / an audit viewer, NOT by guessing a column here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournament_economic_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tea_audit_select ON public.tournament_economic_audit_log;
CREATE POLICY tea_audit_select ON public.tournament_economic_audit_log
  FOR SELECT TO authenticated
  USING (
    club_id IS NOT NULL AND (
      public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR public.is_club_owner(auth.uid(), club_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Grants — least privilege. No anon/PUBLIC. SELECT-only for authenticated;
--    writes happen only through the SECURITY DEFINER trigger.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.tournament_economic_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_economic_audit_log TO authenticated;

-- ---------------------------------------------------------------------------
-- Controlled-apply TEST PLAN (run during 3b-B, inside a transaction, then ROLLBACK):
--   1. BEGIN;
--   2. UPDATE public.tournaments SET guarantee_amount = 300000000 WHERE id = <disposable>;
--      -> expect exactly ONE audit row; changed_fields=["guarantee_amount"],
--         old_values={"guarantee_amount":null}, new_values={"guarantee_amount":300000000}.
--   3. UPDATE the same row's NAME only (a non-economic field);
--      -> expect NO new audit row.
--   4. UPDATE buy_in + rake_amount together in one statement;
--      -> expect ONE audit row listing both changed fields.
--   5. UPDATE guarantee_amount from 300000000 back to NULL;
--      -> expect ONE audit row (value->NULL detected).
--   6. ROLLBACK;  (no persisted data)
--
-- ROLLBACK (undo this migration):
--   DROP TRIGGER IF EXISTS trg_tournament_economic_audit ON public.tournaments;
--   DROP FUNCTION IF EXISTS public.log_tournament_economic_changes();
--   DROP TABLE IF EXISTS public.tournament_economic_audit_log;
--   -- Do NOT drop tournaments.guarantee_amount (that belongs to Phase 3a, not this PR).
-- ---------------------------------------------------------------------------
