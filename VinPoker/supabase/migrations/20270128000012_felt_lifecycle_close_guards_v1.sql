-- Fence legacy tour and tournament close writers against live Floor V3 state.
-- This migration adds guards without changing historical financial calculations.
-- Rollback (new, owner-reviewed migration): drop the three triggers, revoke the
-- two readiness RPCs, then drop their trigger/helper functions. Keep archives
-- and close reports as immutable audit history.
BEGIN;

CREATE OR REPLACE FUNCTION floor_private.felt_tour_close_blockers_v1(
  p_tour_id uuid, p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_tables g
    WHERE g.shift_id = p_tour_id AND g.club_id IS DISTINCT FROM p_club_id
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('table_club_mismatch'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_sessions s
    JOIN public.game_tables g ON g.id = s.game_table_id
    WHERE g.shift_id = p_tour_id AND s.closed_at IS NULL
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('open_table_session'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    JOIN public.game_tables g ON g.id = tt.game_table_id
    WHERE g.shift_id = p_tour_id AND tt.status = 'active'
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('active_tournament_table'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats seat
    JOIN public.tournament_tables tt
      ON tt.id = seat.tournament_table_id OR tt.id = seat.table_id
    JOIN public.game_tables g ON g.id = tt.game_table_id
    WHERE g.shift_id = p_tour_id AND seat.is_active
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('active_seats'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands h
    WHERE h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
      AND (
        EXISTS (
          SELECT 1 FROM public.table_sessions s
          JOIN public.game_tables g ON g.id = s.game_table_id
          WHERE s.id = h.table_session_id AND g.shift_id = p_tour_id
        )
        OR EXISTS (
          SELECT 1 FROM public.tournament_tables tt
          JOIN public.game_tables g ON g.id = tt.game_table_id
          WHERE g.shift_id = p_tour_id AND tt.tournament_id = h.tournament_id
            AND (
              h.tournament_table_id = tt.id
              OR h.table_id IN (tt.id, tt.table_id, tt.game_table_id)
            )
        )
      )
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('active_hand'::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.floor_pending_tracker_moves move
    JOIN public.table_sessions s
      ON s.id IN (move.source_table_session_id, move.destination_table_session_id)
    JOIN public.game_tables g ON g.id = s.game_table_id
    WHERE g.shift_id = p_tour_id AND move.status = 'pending'
  ) THEN
    v_blockers := v_blockers || pg_catalog.to_jsonb('pending_move'::text);
  END IF;
  RETURN v_blockers;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.felt_tour_close_blockers_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION floor_private.felt_guard_tour_archive_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_blockers jsonb;
BEGIN
  -- Floor opens/closures lock the physical table. Hold these locks through
  -- the archive transaction so a session cannot open after the check.
  PERFORM 1 FROM public.game_tables g
  WHERE g.shift_id = NEW.tour_id
  ORDER BY g.id FOR UPDATE;
  v_blockers := floor_private.felt_tour_close_blockers_v1(NEW.tour_id, NEW.club_id);
  IF v_blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_tour_close_blocked',
      DETAIL = v_blockers::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.felt_guard_tour_archive_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_felt_guard_tour_archive_v1 ON public.dealer_swing_archives;
CREATE TRIGGER trg_felt_guard_tour_archive_v1
BEFORE INSERT ON public.dealer_swing_archives
FOR EACH ROW EXECUTE FUNCTION floor_private.felt_guard_tour_archive_v1();

CREATE OR REPLACE FUNCTION floor_private.felt_guard_table_deactivation_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.game_table_id = OLD.id AND s.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'open_table_session';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.felt_guard_table_deactivation_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_felt_guard_table_deactivation_v1 ON public.game_tables;
CREATE TRIGGER trg_felt_guard_table_deactivation_v1
BEFORE UPDATE OF status, shift_id ON public.game_tables
FOR EACH ROW
WHEN ((OLD.status = 'active' AND NEW.status = 'inactive')
   OR (OLD.shift_id IS NOT NULL AND NEW.shift_id IS NULL))
EXECUTE FUNCTION floor_private.felt_guard_table_deactivation_v1();

CREATE OR REPLACE FUNCTION floor_private.felt_tournament_close_blockers_v1(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats seat
    WHERE seat.tournament_id = p_tournament_id AND seat.is_active
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('active_seats'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active'
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('active_tournament_table'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.tournament_id = p_tournament_id AND s.closed_at IS NULL
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('open_table_session'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('active_hand'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.floor_pending_tracker_moves move
    WHERE move.tournament_id = p_tournament_id AND move.status = 'pending'
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('pending_move'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.dealer_assignments assignment
    JOIN public.table_sessions s ON s.id = assignment.table_session_id
    WHERE s.tournament_id = p_tournament_id AND assignment.released_at IS NULL
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('active_dealer_assignment'::text); END IF;
  IF EXISTS (
    SELECT 1 FROM public.dealer_assignments assignment
    JOIN public.tournament_tables tt ON tt.game_table_id = assignment.table_id
    WHERE tt.tournament_id = p_tournament_id
      AND assignment.table_session_id IS NULL AND assignment.released_at IS NULL
  ) THEN v_blockers := v_blockers || pg_catalog.to_jsonb('legacy_dealer_assignment'::text); END IF;
  RETURN v_blockers;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.felt_tournament_close_blockers_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION floor_private.felt_guard_tournament_close_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_blockers jsonb;
BEGIN
  v_blockers := floor_private.felt_tournament_close_blockers_v1(NEW.tournament_id);
  IF v_blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'floor_tournament_close_blocked',
      DETAIL = v_blockers::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.felt_guard_tournament_close_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_felt_guard_close_report_v1 ON public.tournament_close_report;
CREATE TRIGGER trg_felt_guard_close_report_v1
BEFORE INSERT ON public.tournament_close_report
FOR EACH ROW EXECUTE FUNCTION floor_private.felt_guard_tournament_close_v1();

CREATE OR REPLACE FUNCTION public.get_dealer_tour_close_readiness_v1(
  p_tour_id uuid, p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tour public.dealer_shifts%ROWTYPE;
  v_blockers jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_club_dealer_control(auth.uid(), p_club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'permission_denied');
  END IF;
  SELECT * INTO v_tour FROM public.dealer_shifts
  WHERE id = p_tour_id AND club_id = p_club_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tour_not_found');
  END IF;
  v_blockers := floor_private.felt_tour_close_blockers_v1(p_tour_id, p_club_id);
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'ready', v_blockers = '[]'::jsonb,
    'already_closed', v_tour.closed_at IS NOT NULL, 'blockers', v_blockers
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_dealer_tour_close_readiness_v1(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_dealer_tour_close_readiness_v1(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tournament_close_readiness_v1(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tour public.tournaments%ROWTYPE;
  v_blockers jsonb;
  v_entry_count integer;
  v_buy_in bigint;
  v_cash_in bigint;
  v_prize bigint;
BEGIN
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clubs c
    LEFT JOIN public.club_cashiers cc
      ON cc.club_id = c.id AND cc.user_id = auth.uid()
    WHERE c.id = v_tour.club_id
      AND (c.owner_id = auth.uid() OR cc.user_id IS NOT NULL)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_blockers := floor_private.felt_tournament_close_blockers_v1(p_tournament_id);
  SELECT count(*)::integer, coalesce(sum(buy_in), 0)::bigint,
    coalesce(sum(total_pay), 0)::bigint
  INTO v_entry_count, v_buy_in, v_cash_in
  FROM public.tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'confirmed';
  SELECT coalesce(sum(prize), 0)::bigint INTO v_prize
  FROM public.tournament_eliminations WHERE tournament_id = p_tournament_id;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'ready', v_blockers = '[]'::jsonb,
    'blockers', v_blockers, 'already_closed',
    EXISTS (SELECT 1 FROM public.tournament_close_report WHERE tournament_id = p_tournament_id),
    'entry_count', v_entry_count, 'buy_in_total', v_buy_in,
    'cash_in_total', v_cash_in, 'prize_total', v_prize,
    'club_revenue', v_cash_in - v_buy_in,
    'cashier_balance', v_cash_in - v_prize,
    'reconcile_delta', v_buy_in - v_prize,
    'reconciled', v_buy_in = v_prize
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_close_readiness_v1(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_close_readiness_v1(uuid)
  TO authenticated;

COMMIT;
