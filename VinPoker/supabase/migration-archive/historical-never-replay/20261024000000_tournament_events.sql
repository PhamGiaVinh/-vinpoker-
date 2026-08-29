-- ============================================================================
-- MD-1A — Multi-day tournaments: tournament_events parent + flight/final columns
-- ============================================================================
-- SOURCE-ONLY. NOT applied here. Schema foundation for multi-day tournaments
-- (a named "Main Event" grouping flight tournaments + one final tournament).
-- The UI is gated behind FEATURES.multiDayTournaments (false) and nothing queries
-- these objects until the flag is on AND this migration is applied live.
--
-- Architecture-review safety (owner):
--  * tournaments.event_id FK is ON DELETE SET NULL (NEVER cascade-delete tournament
--    rows / flights / final when a parent event is removed).
--  * Circular FK created in order: table+columns first, FK constraints last.
--  * phase CHECK + partial unique indexes (one flight-label / one final per event).
--  * New tournaments columns are NULLABLE → every existing single-day tournament is
--    unaffected (all NULL).
--
-- ROLLBACK: docs/emergency_rollbacks/MD_tournament_events_rollback.sql
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

-- 1. Parent event (final_tournament_id nullable; FK added in step 3 after columns exist).
CREATE TABLE IF NOT EXISTS public.tournament_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name                text NOT NULL,
  itm_percent         numeric NOT NULL DEFAULT 0,   -- per-flight % → ceil() = qualified
  buy_in              integer,                      -- shared flight template
  rake_amount         integer,
  starting_stack      integer,
  final_tournament_id uuid,
  status              text NOT NULL DEFAULT 'scheduled',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. NULLABLE columns on tournaments (existing rows stay NULL → zero behaviour change).
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS event_id     uuid;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS phase        text;   -- 'flight' | 'final' | NULL
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS flight_label text;   -- 'A','B','C'... (flights)

-- 3. Foreign keys (both sides now exist) — ON DELETE SET NULL on both, never cascade.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'tournaments_event_id_fkey'
                   AND conrelid = 'public.tournaments'::regclass) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.tournament_events(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'tournament_events_final_tournament_id_fkey'
                   AND conrelid = 'public.tournament_events'::regclass) THEN
    ALTER TABLE public.tournament_events
      ADD CONSTRAINT tournament_events_final_tournament_id_fkey
      FOREIGN KEY (final_tournament_id) REFERENCES public.tournaments(id) ON DELETE SET NULL;
  END IF;

  -- 4. phase validity (flight requires a label). Existing rows are phase NULL → pass.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'tournaments_phase_check'
                   AND conrelid = 'public.tournaments'::regclass) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_phase_check
      CHECK (phase IS NULL OR phase = 'final' OR (phase = 'flight' AND flight_label IS NOT NULL));
  END IF;
END $$;

-- 5. Partial unique indexes (NULL flight_label can't enforce "one final", so use partials).
CREATE UNIQUE INDEX IF NOT EXISTS tournament_event_flight_unique
  ON public.tournaments (event_id, flight_label)
  WHERE event_id IS NOT NULL AND phase = 'flight';
CREATE UNIQUE INDEX IF NOT EXISTS tournament_event_final_unique
  ON public.tournaments (event_id)
  WHERE event_id IS NOT NULL AND phase = 'final';

-- 6. RLS on tournament_events (mirror the tournaments / club_series_images owner-admin idiom).
ALTER TABLE public.tournament_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'tournament_events' AND policyname = 'tournament_events public read') THEN
    CREATE POLICY "tournament_events public read" ON public.tournament_events
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'tournament_events' AND policyname = 'tournament_events manage') THEN
    CREATE POLICY "tournament_events manage" ON public.tournament_events
      FOR ALL TO authenticated
      USING (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournament_events.club_id AND c.owner_id = auth.uid())
      )
      WITH CHECK (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournament_events.club_id AND c.owner_id = auth.uid())
      );
  END IF;
END $$;
