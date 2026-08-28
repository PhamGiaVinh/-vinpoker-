-- ============================================================================
-- MD-2 — Multi-day qualifiers: floor advances flight players to the final day
-- ============================================================================
-- SOURCE-ONLY. Adds (1) an audit/idempotency table recording who advanced from
-- each flight (this table IS the Final Day "pool"), and (2) an atomic RPC the floor
-- calls to advance a picked set of players. Gated by FEATURES.multiDayTournaments.
--
-- Design (owner, Option A — "vào pool → floor bốc thăm Day 2"): floor PICKS qualifiers
-- (UI suggested count = ceil(flight ENTRANTS × itm_percent/100), rounded up). Advancement
-- is recorded explicitly in tournament_event_qualifiers (idempotent on flight+player) with
-- the player's end-of-flight CARRIED STACK. That stack is SYNCED with the chip master's
-- Bag & Tag (20261021000000): the player's SEALED chip_bag.total_value for the flight (the
-- reconciled, official end-of-flight count) is authoritative; it falls back to the live
-- active-seat chip, then tournament_chip_counts, then 0. This RPC ONLY records the qualifier — it does NOT
-- seat anyone or write money. Final-day seating is a separate atomic "Bốc thăm Day 2" draw
-- (MD-3, seat_day2_qualifiers) that materialises registration + entry + seat carrying each
-- stack, with buy_in=0 (players already paid in the flight → finance-neutral). The qualifiers
-- table is the source of truth for the carried stack until that draw runs.
--
-- Auth: actor = auth.uid(), super_admin OR the flight club's owner OR a club
-- cashier. SECURITY DEFINER, search_path=public. REVOKE PUBLIC/anon, GRANT
-- authenticated. ON DELETE CASCADE on the qualifiers rows is SAFE — they are pure
-- advancement records, not tournament/flight/final rows.
--
-- ROLLBACK: docs/emergency_rollbacks/MD_qualifiers_rollback.sql
-- Controlled apply only (BEGIN..COMMIT). NO db push / deploy_db / schema_migrations.
-- ============================================================================

-- 1. Audit + idempotency table.
CREATE TABLE IF NOT EXISTS public.tournament_event_qualifiers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid NOT NULL REFERENCES public.tournament_events(id) ON DELETE CASCADE,
  flight_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  final_tournament_id  uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id              uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  player_id            uuid NOT NULL,
  carried_stack        integer NOT NULL DEFAULT 0,
  advanced_by          uuid,
  advanced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flight_tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS tournament_event_qualifiers_final_idx
  ON public.tournament_event_qualifiers (final_tournament_id);
CREATE INDEX IF NOT EXISTS tournament_event_qualifiers_event_idx
  ON public.tournament_event_qualifiers (event_id);

-- 2. RLS — read + manage by super_admin OR the club's owner OR a club cashier.
ALTER TABLE public.tournament_event_qualifiers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'tournament_event_qualifiers' AND policyname = 'teq read') THEN
    CREATE POLICY "teq read" ON public.tournament_event_qualifiers
      FOR SELECT TO authenticated
      USING (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournament_event_qualifiers.club_id AND c.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = tournament_event_qualifiers.club_id AND cc.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'tournament_event_qualifiers' AND policyname = 'teq manage') THEN
    CREATE POLICY "teq manage" ON public.tournament_event_qualifiers
      FOR ALL TO authenticated
      USING (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournament_event_qualifiers.club_id AND c.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = tournament_event_qualifiers.club_id AND cc.user_id = auth.uid())
      )
      WITH CHECK (
        has_role(auth.uid(), 'super_admin'::app_role)
        OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = tournament_event_qualifiers.club_id AND c.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = tournament_event_qualifiers.club_id AND cc.user_id = auth.uid())
      );
  END IF;
END $$;

-- 3. Atomic advance RPC.
CREATE OR REPLACE FUNCTION public.advance_flight_qualifiers(
  p_flight_id  uuid,
  p_player_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_club_id    uuid;
  v_event_id   uuid;
  v_phase      text;
  v_final_id   uuid;
  v_authorized boolean;
  v_pid        uuid;
  v_stack      integer;
  v_advanced   integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- resolve flight → club + event + phase
  SELECT t.club_id, t.event_id, t.phase INTO v_club_id, v_event_id, v_phase
  FROM public.tournaments t WHERE t.id = p_flight_id;
  IF v_event_id IS NULL OR v_phase IS DISTINCT FROM 'flight' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_flight');
  END IF;

  SELECT final_tournament_id INTO v_final_id FROM public.tournament_events WHERE id = v_event_id;
  IF v_final_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_final');
  END IF;

  -- authz: super_admin OR flight club's owner OR a club cashier
  SELECT (has_role(v_actor, 'super_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = v_club_id AND c.owner_id = v_actor)
          OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = v_club_id AND cc.user_id = v_actor))
    INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF p_player_ids IS NULL OR array_length(p_player_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'advanced', 0, 'final_tournament_id', v_final_id);
  END IF;

  FOREACH v_pid IN ARRAY p_player_ids LOOP
    -- Carried stack — SYNCED with the chip master's Bag & Tag (chip_bag, day_close): the
    -- player's SEALED bag for this flight is the official, reconciled end-of-flight count,
    -- so it wins. Fall back to the live active-seat chip, then the chip-count tracker, then 0.
    -- Guarded by to_regclass so advancing still works if Bag & Tag is ever rolled back.
    v_stack := NULL;
    IF to_regclass('public.chip_bag') IS NOT NULL THEN
      EXECUTE 'SELECT total_value FROM public.chip_bag
                 WHERE tournament_id = $1 AND player_id = $2 AND sealed = true
                 ORDER BY day_number DESC LIMIT 1'
        INTO v_stack USING p_flight_id, v_pid;
    END IF;
    IF v_stack IS NULL THEN
      SELECT chip_count INTO v_stack FROM public.tournament_seats
        WHERE tournament_id = p_flight_id AND player_id = v_pid AND is_active = true
        ORDER BY entry_number DESC LIMIT 1;
    END IF;
    IF v_stack IS NULL THEN
      SELECT chip_count INTO v_stack FROM public.tournament_chip_counts
        WHERE tournament_id = p_flight_id AND player_id = v_pid
        ORDER BY entry_number DESC LIMIT 1;
    END IF;
    v_stack := COALESCE(v_stack, 0);

    -- record the qualifier into the Day-2 pool (idempotent on flight + player). On a
    -- repeat pick we REFRESH the carried stack (the flight stack may have changed) — the
    -- player only seats once, at the Day-2 draw.
    INSERT INTO public.tournament_event_qualifiers
      (event_id, flight_tournament_id, final_tournament_id, club_id, player_id, carried_stack, advanced_by)
    VALUES (v_event_id, p_flight_id, v_final_id, v_club_id, v_pid, v_stack, v_actor)
    ON CONFLICT (flight_tournament_id, player_id)
      DO UPDATE SET carried_stack = EXCLUDED.carried_stack, advanced_by = EXCLUDED.advanced_by, advanced_at = now();

    v_advanced := v_advanced + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'advanced', v_advanced,
    'final_tournament_id', v_final_id,
    'event_id', v_event_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.advance_flight_qualifiers(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_flight_qualifiers(uuid, uuid[]) TO authenticated;
