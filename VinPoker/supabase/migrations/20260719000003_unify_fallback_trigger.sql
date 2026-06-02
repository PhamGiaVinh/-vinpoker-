-- =============================================================================
-- Migration: Unify fallback trigger into trg_fallback_assignment_defaults
--
-- Context:
--   Phase 1 created two separate BEFORE INSERT triggers on dealer_assignments:
--     - trg_fallback_club_id         (populates club_id from game_tables)
--     - trg_fallback_swing_due_at    (populates swing_due_at from swing_config)
--
--   Two triggers is fragile (alphabetical ordering, harder to maintain).
--   Replace with a single unified trigger that does both in one pass:
--     - trg_fallback_assignment_defaults
--
--   The old trigger functions and triggers are DROPPED.
--
-- Safety net: This is fallback logic only. Application code should set
-- club_id and swing_due_at explicitly. This trigger exists for forward
-- compatibility and as a safety net. Eventual drop planned.
-- =============================================================================

BEGIN;

-- ─── STEP 1: Drop the old triggers ───────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_fallback_club_id      ON dealer_assignments;
DROP TRIGGER IF EXISTS trg_fallback_swing_due_at ON dealer_assignments;

-- ─── STEP 2: Drop the old trigger functions (replace with unified one) ──────
DROP FUNCTION IF EXISTS trg_fallback_club_id();
DROP FUNCTION IF EXISTS trg_fallback_swing_due_at();

-- ─── STEP 3: Create the unified trigger function ────────────────────────────
CREATE OR REPLACE FUNCTION trg_fallback_assignment_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_club_id   UUID;
  v_duration  INT;
BEGIN
  -- Step 1: Resolve club_id (always, in case caller forgot)
  IF NEW.club_id IS NULL THEN
    SELECT gt.club_id INTO v_club_id
    FROM game_tables gt
    WHERE gt.id = NEW.table_id;

    IF FOUND THEN
      NEW.club_id := v_club_id;
    ELSE
      RAISE EXCEPTION '[trg_fallback_assignment_defaults] table_id=% not found in game_tables', NEW.table_id;
    END IF;
  END IF;

  -- Step 2: Resolve swing_due_at if NULL
  IF NEW.swing_due_at IS NULL THEN
    SELECT COALESCE(sc.base_duration_minutes, 45)
    INTO v_duration
    FROM swing_config sc
    WHERE sc.club_id = NEW.club_id
      AND sc.table_type = 'tournament'
    LIMIT 1;

    IF v_duration IS NULL THEN
      v_duration := 45; -- hard fallback
    END IF;

    NEW.swing_due_at := COALESCE(NEW.assigned_at, NOW()) + (v_duration || ' minutes')::INTERVAL;
    NEW.duration_minutes := COALESCE(NEW.duration_minutes, v_duration);

    RAISE WARNING '[trg_fallback_assignment_defaults] swing_due_at was NULL — computed % for table %',
      NEW.swing_due_at, NEW.table_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fallback_assignment_defaults() IS
  'Safety net trigger: resolves club_id (from game_tables) and swing_due_at (from swing_config) if INSERT omits them. '
  'Application code should set both explicitly; this is for forward-compat and migration safety.';

-- ─── STEP 4: Create the unified trigger ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_fallback_assignment_defaults ON dealer_assignments;
CREATE TRIGGER trg_fallback_assignment_defaults
  BEFORE INSERT ON dealer_assignments
  FOR EACH ROW
  EXECUTE FUNCTION trg_fallback_assignment_defaults();

COMMIT;
