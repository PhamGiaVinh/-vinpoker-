-- PATCH 4 / STAGE A — floor "Loại" (seat freed) now mirrors the canonical "out of tournament" signal.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: the floor bust ("Loại" → edge fn tournament-live-draw `update_seats`) only sets
-- tournament_seats.is_active=false; the EXISTING BEFORE trigger sync_tournament_seat_status then flips the
-- seat status to 'busted'. Neither touches tournament_entries.status — so a floor-kicked player's entry stays
-- 'seated', and the re-entry gate (entry.status='busted') would REJECT them. This adds a SEPARATE AFTER
-- trigger that mirrors a genuine bust onto the entry, giving ONE reliable "eliminated from tournament" signal
-- (this also fixes the existing cashier reenter_tournament_player gate).
--
-- MOVE-PROOF: a move (move_player_seat sets the old seat status='moved' + inserts a NEW active seat carrying
-- the SAME entry_id) is excluded TWO ways — the WHEN clause requires NEW.status='busted' (a move is 'moved'),
-- and the body requires the entry to have NO surviving active seat (a move keeps one alive).
--
-- SAFETY (P0): the body is wrapped EXCEPTION WHEN OTHERS THEN NULL — an entry-sync failure must NEVER abort
-- the floor's seat UPDATE (an AFTER trigger that raises would roll back the "Loại"). Freeing the seat is the
-- load-bearing action; mirroring the entry is best-effort.
--
-- Does NOT modify sync_tournament_seat_status / trg_sync_tournament_seat_status (the BEFORE trigger).
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- Rollback: DROP TRIGGER trg_floor_bust_sync_entry ON public.tournament_seats;
--           DROP FUNCTION public.floor_bust_sync_entry();

CREATE OR REPLACE FUNCTION public.floor_bust_sync_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Best-effort: never let an entry-sync error abort the seat UPDATE (the floor "Loại").
  BEGIN
    IF NEW.entry_id IS NOT NULL THEN
      -- Genuine bust: this entry has NO other active seat (a move keeps a new active seat alive).
      IF NOT EXISTS (
        SELECT 1 FROM public.tournament_seats x
        WHERE x.entry_id = NEW.entry_id AND x.is_active = true
      ) THEN
        UPDATE public.tournament_entries
          SET status = 'busted', busted_at = now()
          WHERE id = NEW.entry_id AND status = 'seated';
      END IF;
    ELSE
      -- Legacy seat with no entry_id link: fall back to (tournament, player), still requiring no active seat.
      IF NOT EXISTS (
        SELECT 1 FROM public.tournament_seats x
        WHERE x.tournament_id = NEW.tournament_id AND x.player_id = NEW.player_id AND x.is_active = true
      ) THEN
        UPDATE public.tournament_entries
          SET status = 'busted', busted_at = now()
          WHERE tournament_id = NEW.tournament_id AND player_id = NEW.player_id AND status = 'seated';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- entry mirror is best-effort; the seat UPDATE must always stand
  END;
  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_floor_bust_sync_entry ON public.tournament_seats;
CREATE TRIGGER trg_floor_bust_sync_entry
  AFTER UPDATE OF is_active ON public.tournament_seats
  FOR EACH ROW
  WHEN (OLD.is_active = true AND NEW.is_active = false AND NEW.status = 'busted')
  EXECUTE FUNCTION public.floor_bust_sync_entry();
