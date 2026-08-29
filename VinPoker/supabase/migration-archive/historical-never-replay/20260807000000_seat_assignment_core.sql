-- ============================================================================
-- Seat Assignment Module — Phase 1: Database Core
-- ============================================================================

-- ============================================================================
-- 1. Extend tournament_tables
-- ============================================================================

ALTER TABLE public.tournament_tables
  ADD COLUMN IF NOT EXISTS table_number INTEGER,
  ADD COLUMN IF NOT EXISTS max_seats    INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS status       TEXT    NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_tables'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%active%'
      AND pg_get_constraintdef(oid) LIKE '%broken%'
  ) THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_status_check
      CHECK (status IN ('active', 'broken', 'closed'));
  END IF;
END $$;

UPDATE public.tournament_tables
SET table_number = sub.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tournament_id
           ORDER BY created_at, id
         ) AS rn
  FROM public.tournament_tables
) sub
WHERE tournament_tables.id = sub.id
  AND tournament_tables.table_number IS NULL;

-- ============================================================================
-- 2. Create tournament_entries
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tournament_entries (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id   UUID        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  registration_id UUID        REFERENCES public.tournament_registrations(id) ON DELETE SET NULL,
  player_id       UUID        NOT NULL,
  entry_no        INTEGER     NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'online'
                              CHECK (source IN ('online', 'manual', 'staff')),
  status          TEXT        NOT NULL DEFAULT 'registered'
                              CHECK (status IN ('registered', 'seated', 'busted', 'finished', 'cancelled')),
  current_stack   INTEGER     NOT NULL DEFAULT 0,
  table_id        UUID        REFERENCES public.game_tables(id),
  seat_id         UUID,
  seat_number     INTEGER,
  checked_in_at   TIMESTAMPTZ,
  seated_at       TIMESTAMPTZ,
  busted_at       TIMESTAMPTZ,
  finished_place  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tournament_entries_per_entry UNIQUE (tournament_id, player_id, entry_no)
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament_status
  ON public.tournament_entries (tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_registration
  ON public.tournament_entries (registration_id)
  WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_entries_player
  ON public.tournament_entries (tournament_id, player_id);

CREATE OR REPLACE FUNCTION public.touch_tournament_entries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_entries_updated_at ON public.tournament_entries;
CREATE TRIGGER trg_tournament_entries_updated_at
  BEFORE UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_tournament_entries_updated_at();

-- ============================================================================
-- 3. Extend tournament_seats
-- ============================================================================

ALTER TABLE public.tournament_seats
  ADD COLUMN IF NOT EXISTS entry_id       UUID,
  ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by    UUID,
  ADD COLUMN IF NOT EXISTS assigned_at    TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_seats'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%moved%'
  ) THEN
    ALTER TABLE public.tournament_seats
      ADD CONSTRAINT tournament_seats_status_check
      CHECK (status IN ('active', 'moved', 'busted', 'cancelled'));
  END IF;
END $$;

-- ============================================================================
-- 4. Migrate the unique constraint on tournament_seats
-- ============================================================================

DO $$
DECLARE
  v_constraint TEXT;
  v_index      TEXT;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.tournament_seats'::regclass
    AND contype = 'u'
    AND (
      SELECT ARRAY_AGG(a.attname ORDER BY a.attname)
      FROM pg_attribute a
      WHERE a.attrelid = conrelid AND a.attnum = ANY(conkey)
    ) = ARRAY['player_id', 'tournament_id'];

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tournament_seats DROP CONSTRAINT %I', v_constraint);
    RAISE NOTICE 'Dropped UNIQUE constraint % on tournament_seats(tournament_id, player_id)', v_constraint;
  END IF;

  SELECT indexname INTO v_index
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename  = 'tournament_seats'
    AND indexdef NOT LIKE '%WHERE%'
    AND indexdef LIKE '%player_id%'
    AND indexdef LIKE '%tournament_id%'
    AND indexdef NOT LIKE '%entry_number%';

  IF v_index IS NOT NULL AND v_constraint IS NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_index);
    RAISE NOTICE 'Dropped unique index % on tournament_seats(tournament_id, player_id)', v_index;
  END IF;
END $$;

-- Drop any full (non-partial) UNIQUE(tournament_id, player_id, entry_number) constraints
-- on tournament_seats. Move history requires multiple rows per entry; the partial
-- indexes uq_tournament_seats_active_player + uq_tournament_seats_active_seat are
-- the correct guards. Do NOT re-add a non-partial unique on these columns.
ALTER TABLE public.tournament_seats DROP CONSTRAINT IF EXISTS uq_tournament_seats_per_entry;
ALTER TABLE public.tournament_seats DROP CONSTRAINT IF EXISTS tournament_seats_unique_entry;

-- ============================================================================
-- 5. Guard check + create partial unique indexes
-- ============================================================================

DO $$
DECLARE
  v_dupe_seat   INT;
  v_dupe_player INT;
BEGIN
  SELECT COUNT(*) INTO v_dupe_seat
  FROM (
    SELECT table_id, seat_number, COUNT(*) AS cnt
    FROM public.tournament_seats
    WHERE is_active = true
    GROUP BY table_id, seat_number
    HAVING COUNT(*) > 1
  ) x;

  IF v_dupe_seat > 0 THEN
    RAISE WARNING '% duplicate active (table_id, seat_number) pairs found. Fix data before re-running migration.', v_dupe_seat;
  ELSE
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_seat
      ON public.tournament_seats (table_id, seat_number)
      WHERE is_active = true
    ';
    RAISE NOTICE 'Created uq_tournament_seats_active_seat';
  END IF;

  SELECT COUNT(*) INTO v_dupe_player
  FROM (
    SELECT tournament_id, player_id, COUNT(*) AS cnt
    FROM public.tournament_seats
    WHERE is_active = true
    GROUP BY tournament_id, player_id
    HAVING COUNT(*) > 1
  ) x;

  IF v_dupe_player > 0 THEN
    RAISE WARNING '% duplicate active (tournament_id, player_id) pairs found. Fix data before re-running migration.', v_dupe_player;
  ELSE
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_player
      ON public.tournament_seats (tournament_id, player_id)
      WHERE is_active = true
    ';
    RAISE NOTICE 'Created uq_tournament_seats_active_player';
  END IF;
END $$;

-- ============================================================================
-- 6. Sync trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_tournament_seat_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NOT NULL THEN
      NEW.is_active := (NEW.status = 'active');
    ELSE
      NEW.status := CASE WHEN NEW.is_active THEN 'active' ELSE 'busted' END;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.is_active := (NEW.status = 'active');
    ELSIF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      IF NOT NEW.is_active AND NEW.status = 'active' THEN
        NEW.status := 'busted';
      ELSIF NEW.is_active THEN
        NEW.status := 'active';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tournament_seat_status ON public.tournament_seats;
CREATE TRIGGER trg_sync_tournament_seat_status
  BEFORE INSERT OR UPDATE OF is_active, status
  ON public.tournament_seats
  FOR EACH ROW EXECUTE FUNCTION public.sync_tournament_seat_status();

-- ============================================================================
-- 7. Create seat_draw_receipts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seat_draw_receipts (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id   UUID        NOT NULL REFERENCES public.tournaments(id)            ON DELETE CASCADE,
  registration_id UUID        REFERENCES public.tournament_registrations(id)        ON DELETE SET NULL,
  entry_id        UUID        REFERENCES public.tournament_entries(id)              ON DELETE SET NULL,
  player_id       UUID        NOT NULL,
  display_name    TEXT        NOT NULL,
  table_id        UUID        REFERENCES public.game_tables(id),
  table_number    INTEGER,
  seat_id         UUID,
  seat_number     INTEGER     NOT NULL,
  receipt_code    TEXT        NOT NULL,
  qr_payload      JSONB       NOT NULL DEFAULT '{}',
  draw_type       TEXT        NOT NULL
                              CHECK (draw_type IN ('initial', 'manual_move', 'final_table_redraw', 'reprint')),
  status          TEXT        NOT NULL DEFAULT 'issued'
                              CHECK (status IN ('issued', 'printed', 'cancelled')),
  issued_by       UUID,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  CONSTRAINT uq_seat_draw_receipts_code UNIQUE (receipt_code)
);

CREATE INDEX IF NOT EXISTS idx_seat_draw_receipts_player
  ON public.seat_draw_receipts (player_id, tournament_id);
CREATE INDEX IF NOT EXISTS idx_seat_draw_receipts_entry
  ON public.seat_draw_receipts (entry_id)
  WHERE entry_id IS NOT NULL;

-- ============================================================================
-- 8. Create seat_assignment_history
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seat_assignment_history (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id     UUID        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  entry_id          UUID        NOT NULL REFERENCES public.tournament_entries(id) ON DELETE CASCADE,
  player_id         UUID        NOT NULL,
  from_table_id     UUID,
  from_table_number INTEGER,
  from_seat_number  INTEGER,
  to_table_id       UUID        REFERENCES public.game_tables(id),
  to_table_number   INTEGER,
  to_seat_number    INTEGER     NOT NULL,
  reason            TEXT        NOT NULL DEFAULT 'initial_draw',
  draw_type         TEXT        NOT NULL
                                CHECK (draw_type IN ('initial', 'manual_move', 'final_table_redraw')),
  actor_user_id     UUID        NOT NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seat_assignment_history_entry
  ON public.seat_assignment_history (entry_id);
CREATE INDEX IF NOT EXISTS idx_seat_assignment_history_tournament
  ON public.seat_assignment_history (tournament_id, created_at DESC);

-- ============================================================================
-- 9. Row Level Security
-- ============================================================================

ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tournament_entries'
                 AND policyname='tournament_entries_select_authenticated') THEN
    CREATE POLICY "tournament_entries_select_authenticated"
      ON public.tournament_entries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tournament_entries'
                 AND policyname='tournament_entries_write_club_admin') THEN
    CREATE POLICY "tournament_entries_write_club_admin"
      ON public.tournament_entries FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.tournaments t
          LEFT JOIN public.clubs c ON c.id = t.club_id
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
          WHERE t.id = tournament_entries.tournament_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END $$;

ALTER TABLE public.seat_draw_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='seat_draw_receipts'
                 AND policyname='seat_draw_receipts_select_authenticated') THEN
    CREATE POLICY "seat_draw_receipts_select_authenticated"
      ON public.seat_draw_receipts FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='seat_draw_receipts'
                 AND policyname='seat_draw_receipts_write_club_admin') THEN
    CREATE POLICY "seat_draw_receipts_write_club_admin"
      ON public.seat_draw_receipts FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.tournaments t
          LEFT JOIN public.clubs c ON c.id = t.club_id
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
          WHERE t.id = seat_draw_receipts.tournament_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END $$;

ALTER TABLE public.seat_assignment_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='seat_assignment_history'
                 AND policyname='seat_assignment_history_select_authenticated') THEN
    CREATE POLICY "seat_assignment_history_select_authenticated"
      ON public.seat_assignment_history FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='seat_assignment_history'
                 AND policyname='seat_assignment_history_write_club_admin') THEN
    CREATE POLICY "seat_assignment_history_write_club_admin"
      ON public.seat_assignment_history FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.tournaments t
          LEFT JOIN public.clubs c ON c.id = t.club_id
          LEFT JOIN public.club_cashiers cc
            ON cc.club_id = t.club_id AND cc.user_id = auth.uid()
          WHERE t.id = seat_assignment_history.tournament_id
            AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
        )
      );
  END IF;
END $$;
