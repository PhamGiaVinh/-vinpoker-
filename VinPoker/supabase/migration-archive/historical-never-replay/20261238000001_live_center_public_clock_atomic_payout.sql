-- VinPoker Live Center + public clock + atomic Floor payout (SOURCE-ONLY).
-- CRITICAL/RED: do not apply outside the controlled DB runbook and TEST UAT.
-- Additive rollback: revoke the functions, drop the new indexes/trigger/columns only
-- after confirming no live consumer or result row depends on them. Never DROP data blindly.

-- Per-hand identity is immutable display context. A trigger avoids redefining the
-- current start_hand/record_hand functions and therefore survives RPC version drift.
ALTER TABLE public.hand_players ADD COLUMN IF NOT EXISTS player_name text;
ALTER TABLE public.hand_players ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.snapshot_hand_player_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament_id uuid;
  v_table_id uuid;
BEGIN
  SELECT h.tournament_id, h.table_id INTO v_tournament_id, v_table_id
  FROM public.tournament_hands h WHERE h.id = NEW.hand_id;

  IF NEW.player_name IS NULL OR NEW.avatar_url IS NULL THEN
    SELECT COALESCE(NEW.player_name, s.player_name), COALESCE(NEW.avatar_url, s.avatar_url)
      INTO NEW.player_name, NEW.avatar_url
    FROM public.tournament_seats s
    WHERE s.tournament_id = v_tournament_id
      AND s.player_id = NEW.player_id
    ORDER BY (s.table_id = v_table_id AND s.seat_number = NEW.seat_number) DESC, s.assigned_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_hand_player_identity ON public.hand_players;
CREATE TRIGGER trg_snapshot_hand_player_identity
BEFORE INSERT OR UPDATE OF player_id, seat_number ON public.hand_players
FOR EACH ROW EXECUTE FUNCTION public.snapshot_hand_player_identity();

-- Best-effort historical snapshot. Empty names remain null and use viewer fallback.
WITH identity_snapshot AS (
  SELECT DISTINCT ON (hp.hand_id, hp.player_id, hp.entry_number)
    hp.hand_id, hp.player_id, hp.entry_number, s.player_name, s.avatar_url
  FROM public.hand_players hp
  JOIN public.tournament_hands h ON h.id=hp.hand_id
  JOIN public.tournament_seats s ON s.tournament_id=h.tournament_id AND s.player_id=hp.player_id
  ORDER BY hp.hand_id, hp.player_id, hp.entry_number,
    (s.table_id=h.table_id AND s.seat_number=hp.seat_number) DESC,
    s.assigned_at DESC NULLS LAST, s.created_at DESC
)
UPDATE public.hand_players hp
SET player_name=COALESCE(hp.player_name,snapshot.player_name),
    avatar_url=COALESCE(hp.avatar_url,snapshot.avatar_url)
FROM identity_snapshot snapshot
WHERE hp.hand_id=snapshot.hand_id AND hp.player_id=snapshot.player_id AND hp.entry_number=snapshot.entry_number
  AND (hp.player_name IS NULL OR hp.avatar_url IS NULL);

-- Floor results can be created without a tracked hand, but keep old hand-linked rows intact.
ALTER TABLE public.tournament_eliminations ALTER COLUMN hand_id DROP NOT NULL;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'hand';
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS result_kind text NOT NULL DEFAULT 'elimination';
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS seat_id uuid REFERENCES public.tournament_seats(id) ON DELETE SET NULL;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS player_name text;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.tournament_eliminations ADD COLUMN IF NOT EXISTS awarded_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.tournament_eliminations ADD CONSTRAINT tournament_eliminations_source_check
    CHECK (source IN ('hand','floor','finalize','repair'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tournament_eliminations ADD CONSTRAINT tournament_eliminations_result_kind_check
    CHECK (result_kind IN ('elimination','winner','provisional','official'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_eliminations_idempotency
  ON public.tournament_eliminations(tournament_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_eliminations_result_entry_place
  ON public.tournament_eliminations(tournament_id, player_id, entry_number, position)
  WHERE source IN ('floor','finalize');

-- Public clock: only tournament-level information that is already public.
CREATE OR REPLACE FUNCTION public.get_public_tournament_clock_summary(p_tournament_id uuid)
RETURNS TABLE (
  tournament_id uuid, name text, status text, starts_at timestamptz,
  guarantee numeric, buy_in numeric, players_remaining integer, current_level integer,
  small_blind numeric, big_blind numeric, big_blind_ante numeric, level_ends_at timestamptz,
  next_small_blind numeric, next_big_blind numeric, next_big_blind_ante numeric,
  entries bigint, average_stack numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_row AS (
    SELECT l.* FROM public.tournament_levels l
    JOIN public.tournaments t ON t.id = l.tournament_id
    WHERE l.tournament_id = p_tournament_id AND l.level_number = t.current_level
    LIMIT 1
  ), next_row AS (
    SELECT l.* FROM public.tournament_levels l
    JOIN public.tournaments t ON t.id = l.tournament_id
    WHERE l.tournament_id = p_tournament_id AND l.level_number > COALESCE(t.current_level, 0) AND NOT l.is_break
    ORDER BY l.level_number LIMIT 1
  )
  SELECT t.id, t.name, t.status, t.start_time, t.guarantee_amount, t.buy_in,
    t.players_remaining, t.current_level,
    COALESCE(c.small_blind,0), COALESCE(c.big_blind,0), COALESCE(c.ante,0),
    CASE WHEN t.clock_started_at IS NULL OR t.clock_paused_at IS NOT NULL THEN NULL
      ELSE t.clock_started_at + make_interval(mins => COALESCE(c.duration_minutes,t.minutes_per_level))
        + make_interval(secs => COALESCE(t.pause_accumulated,0)) END,
    n.small_blind, n.big_blind, n.ante,
    (SELECT count(*) FROM public.tournament_entries e WHERE e.tournament_id = t.id),
    t.average_stack
  FROM public.tournaments t
  LEFT JOIN current_row c ON true
  LEFT JOIN next_row n ON true
  WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_clock_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_clock_summary(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_tournament_results(p_tournament_id uuid)
RETURNS TABLE (
  place integer, prize numeric, player_name text, avatar_url text,
  result_status text, awarded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.position, p.amount,
    r.player_name, r.avatar_url,
    CASE WHEN r.id IS NULL THEN 'open'
         WHEN r.result_kind IN ('official','winner') THEN 'official'
         ELSE 'provisional' END,
    r.awarded_at
  FROM public.tournament_prizes p
  LEFT JOIN LATERAL (
    SELECT e.id, e.player_name, e.avatar_url, e.result_kind, e.awarded_at
    FROM public.tournament_eliminations e
    WHERE e.tournament_id = p.tournament_id AND e.position = p.position
    ORDER BY (e.result_kind IN ('official','winner')) DESC, e.created_at DESC
    LIMIT 1
  ) r ON true
  JOIN public.tournaments t ON t.id = p.tournament_id AND t.deleted_at IS NULL
  WHERE p.tournament_id = p_tournament_id
  ORDER BY p.position;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_results(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_tournament_bust(p_tournament_id uuid, p_seat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_club uuid; v_seat public.tournament_seats%ROWTYPE;
  v_active integer; v_prize numeric := 0; v_reg_closed timestamptz;
BEGIN
  SELECT club_id, registration_closed_at INTO v_club, v_reg_closed FROM public.tournaments WHERE id = p_tournament_id;
  IF v_club IS NULL OR NOT (public.is_club_owner(v_uid,v_club) OR public.is_club_admin(v_uid,v_club) OR public.is_club_floor(v_uid,v_club)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_seat FROM public.tournament_seats WHERE id=p_seat_id AND tournament_id=p_tournament_id;
  IF NOT FOUND OR NOT v_seat.is_active THEN RAISE EXCEPTION 'seat_not_active' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO v_active FROM public.tournament_seats WHERE tournament_id=p_tournament_id AND is_active;
  SELECT COALESCE(amount,0) INTO v_prize FROM public.tournament_prizes WHERE tournament_id=p_tournament_id AND position=v_active;
  RETURN jsonb_build_object('tournament_id',p_tournament_id,'seat_id',p_seat_id,'player_name',v_seat.player_name,
    'place',v_active,'prize',v_prize,'active_count_revision',v_active,
    'registration_closed',v_reg_closed IS NOT NULL,'can_confirm',NOT(v_prize>0 AND v_reg_closed IS NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.preview_tournament_bust(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tournament_bust(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bust_tournament_player_with_payout(
  p_tournament_id uuid, p_seat_id uuid, p_expected_active_count integer, p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_t public.tournaments%ROWTYPE; v_seat public.tournament_seats%ROWTYPE;
  v_active integer; v_bust_prize numeric := 0; v_winner_prize numeric := 0; v_existing public.tournament_eliminations%ROWTYPE;
  v_entry integer; v_winner public.tournament_seats%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 12 THEN RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM public.tournament_eliminations WHERE tournament_id=p_tournament_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('status','already_applied','place',v_existing.position,'prize',v_existing.prize,'player_name',v_existing.player_name); END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_club_owner(v_uid,v_t.club_id) OR public.is_club_admin(v_uid,v_t.club_id) OR public.is_club_floor(v_uid,v_t.club_id)) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_seat FROM public.tournament_seats WHERE id=p_seat_id AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR NOT v_seat.is_active THEN RAISE EXCEPTION 'seat_not_active' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO v_active FROM public.tournament_seats WHERE tournament_id=p_tournament_id AND is_active;
  IF v_active <> p_expected_active_count THEN RAISE EXCEPTION 'stale_active_count' USING ERRCODE='40001'; END IF;
  IF v_seat.chip_count <> 0 OR EXISTS (SELECT 1 FROM public.tournament_chip_counts c WHERE c.tournament_id=p_tournament_id AND c.player_id=v_seat.player_id AND c.chip_count<>0) THEN RAISE EXCEPTION 'player_has_chips' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_hands h JOIN public.hand_players hp ON hp.hand_id=h.id WHERE h.tournament_id=p_tournament_id AND h.status='in_progress' AND hp.player_id=v_seat.player_id) THEN RAISE EXCEPTION 'player_in_active_hand' USING ERRCODE='P0001'; END IF;

  SELECT COALESCE(amount,0) INTO v_bust_prize FROM public.tournament_prizes WHERE tournament_id=p_tournament_id AND position=v_active;
  IF v_bust_prize>0 AND v_t.registration_closed_at IS NULL THEN RAISE EXCEPTION 'registration_open_itm' USING ERRCODE='P0001'; END IF;
  v_entry := COALESCE(v_seat.entry_number,1);

  UPDATE public.tournament_seats SET is_active=false,chip_count=0 WHERE id=p_seat_id;
  UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now(),finished_place=v_active,updated_at=now()
    WHERE id=v_seat.entry_id OR (tournament_id=p_tournament_id AND player_id=v_seat.player_id AND entry_no=v_entry);
  UPDATE public.tournaments SET players_remaining=v_active-1,current_players=v_active-1,updated_at=now() WHERE id=p_tournament_id;
  INSERT INTO public.tournament_eliminations(tournament_id,hand_id,player_id,entry_number,position,prize,source,result_kind,seat_id,player_name,avatar_url,idempotency_key,actor_user_id,awarded_at)
    VALUES(p_tournament_id,NULL,v_seat.player_id,v_entry,v_active,v_bust_prize,'floor',CASE WHEN v_bust_prize>0 THEN 'official' ELSE 'elimination' END,p_seat_id,v_seat.player_name,v_seat.avatar_url,p_idempotency_key,v_uid,now());

  IF v_active=2 THEN
    SELECT * INTO v_winner FROM public.tournament_seats WHERE tournament_id=p_tournament_id AND is_active ORDER BY seat_number LIMIT 1 FOR UPDATE;
    SELECT COALESCE(amount,0) INTO v_winner_prize FROM public.tournament_prizes WHERE tournament_id=p_tournament_id AND position=1;
    INSERT INTO public.tournament_eliminations(tournament_id,hand_id,player_id,entry_number,position,prize,source,result_kind,seat_id,player_name,avatar_url,idempotency_key,actor_user_id,awarded_at)
      VALUES(p_tournament_id,NULL,v_winner.player_id,COALESCE(v_winner.entry_number,1),1,v_winner_prize,'floor','winner',v_winner.id,v_winner.player_name,v_winner.avatar_url,p_idempotency_key||':winner',v_uid,now())
      ON CONFLICT DO NOTHING;
    UPDATE public.tournament_entries SET finished_place=1,updated_at=now() WHERE id=v_winner.entry_id;
  END IF;

  INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
    VALUES(v_t.club_id,v_uid,'tournament_player_busted_with_payout','tournament',p_tournament_id,
      jsonb_build_object('seat_id',p_seat_id,'player_id',v_seat.player_id,'place',v_active,'prize',v_bust_prize,'idempotency_key',p_idempotency_key));
  RETURN jsonb_build_object('status','applied','place',v_active,'prize',v_bust_prize,'player_name',v_seat.player_name,'players_remaining',v_active-1);
END;
$$;
REVOKE ALL ON FUNCTION public.bust_tournament_player_with_payout(uuid,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bust_tournament_player_with_payout(uuid,uuid,integer,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.bust_tournament_player_with_payout(uuid,uuid,integer,text) IS
  'CRITICAL: atomic Floor bust/result path. Client supplies intent only; server derives place, prize and identity.';
