-- ============================================================================
-- ROLLBACK — MD-1A Multi-day tournaments schema (20261024000000_tournament_events)
-- ============================================================================
-- Reverts the additive schema. Safe to run if no multi-day event data exists yet
-- (with FEATURES.multiDayTournaments OFF nothing writes these objects). If events
-- DO exist, dropping tournament_events sets tournaments.event_id back to NULL
-- (ON DELETE SET NULL) — it does NOT delete any tournament/flight/final rows.
-- Drop dependents (indexes/constraints/columns) before the table.
-- ============================================================================

DROP INDEX IF EXISTS public.tournament_event_flight_unique;
DROP INDEX IF EXISTS public.tournament_event_final_unique;

ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_phase_check;
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_event_id_fkey;
ALTER TABLE public.tournament_events DROP CONSTRAINT IF EXISTS tournament_events_final_tournament_id_fkey;

ALTER TABLE public.tournaments DROP COLUMN IF EXISTS flight_label;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS phase;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS event_id;

DROP TABLE IF EXISTS public.tournament_events;
