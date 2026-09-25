-- Floor V3 roster repair. Source-only until the owner approves a controlled DB apply.
-- Rollback: restore the previous floor_bust_sync_entry() body and the prior
-- tournament_seats_status_check only after verifying no free_sit rows exist.
-- This migration changes no business rows, chip balances, or payouts.

-- The legacy AFTER trigger predates the V3 atomic bust writer. It updates the
-- entry to busted before floor_bust_player_v3 can perform its own guarded
-- entry update, causing entry_state_changed and rolling back the bust.
-- Legacy seats keep their original mirror behavior; V3 owns both writes.
CREATE OR REPLACE FUNCTION public.floor_bust_sync_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.tournament_table_id IS NOT NULL AND NEW.table_session_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF NEW.entry_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tournament_seats x
        WHERE x.entry_id = NEW.entry_id AND x.is_active
      ) THEN
        UPDATE public.tournament_entries
        SET status = 'busted', busted_at = pg_catalog.now()
        WHERE id = NEW.entry_id AND status = 'seated';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.tournament_seats x
      WHERE x.tournament_id = NEW.tournament_id
        AND x.player_id = NEW.player_id AND x.is_active
    ) THEN
      UPDATE public.tournament_entries
      SET status = 'busted', busted_at = pg_catalog.now()
      WHERE tournament_id = NEW.tournament_id
        AND player_id = NEW.player_id AND status = 'seated';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Preserve the legacy best-effort behavior only for legacy seats.
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.floor_bust_sync_entry() FROM PUBLIC, anon, authenticated;

-- The Free Sit writer intentionally records a distinct inactive seat state.
-- The live check constraint predates that writer and omitted the new value.
ALTER TABLE public.tournament_seats
  DROP CONSTRAINT IF EXISTS tournament_seats_status_check,
  ADD CONSTRAINT tournament_seats_status_check
  CHECK (status IN ('active', 'moved', 'busted', 'cancelled', 'free_sit'));
