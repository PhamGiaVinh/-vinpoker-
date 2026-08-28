-- ĐỢT G2 — apply a resettle-forward correction ATOMICALLY + immutable audit.
--
-- Writes the corrected chip stacks produced by the pure resettle-forward engine
-- (src/lib/tracker-poker/resettleForward.ts, Phase G1) after an operator edits a
-- COMPLETED hand. Because the engine BLOCKS every change that would flip a player
-- between alive and busted (elimination_changed / eliminated_player_has_future_actions
-- / all_in_cap_changed), an APPLIED resettle is a pure chip RE-ATTRIBUTION whose total
-- is conserved. This RPC therefore writes ONLY chip AMOUNTS:
--   • hand_players.ending_stack  (historical record shown in Lịch sử ván)
--   • tournament_chip_counts.chip_count + tournament_seats.chip_count  (live money)
-- and NEVER touches is_active / is_eliminated / tournament_eliminations / bust_order /
-- tournaments aggregates. It re-enforces the money invariants server-side (role,
-- conservation, no bust flip, non-negative) and refuses otherwise — nothing partial is
-- ever written (single transaction). Board/hole/action display edits go through the
-- separate F2 RPC edit_completed_hand; this RPC is chips-only.
--
-- Trust model: the corrected stacks are computed by the deterministic G1 engine on the
-- client (same trust surface as record_hand, which already trusts client-settled
-- stacks). The compensating control is the immutable resettle_forward_log (actor +
-- reason + full before/after snapshot) — every correction is auditable by floor/owner.
--
-- Idempotent to re-run (CREATE ... IF NOT EXISTS / CREATE OR REPLACE); the RPC sets
-- ABSOLUTE values, so a repeat with the same inputs is a no-op re-write + a new log row.

-- ── 1. Immutable audit log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resettle_forward_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id      uuid NOT NULL,
  target_hand_id     uuid NOT NULL,
  target_hand_number integer,
  actor_user_id      uuid NOT NULL,
  reason             text NOT NULL,
  target_winner_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  before             jsonb NOT NULL,
  after              jsonb NOT NULL,
  changed_players    integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resettle_forward_log_thand ON public.resettle_forward_log (target_hand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resettle_forward_log_club ON public.resettle_forward_log (club_id, created_at DESC);

ALTER TABLE public.resettle_forward_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resettle_forward_log readable by tracker/floor" ON public.resettle_forward_log;
CREATE POLICY "resettle_forward_log readable by tracker/floor" ON public.resettle_forward_log
  FOR SELECT TO authenticated
  USING (public.is_club_tracker(auth.uid(), club_id) OR public.is_club_floor(auth.uid(), club_id));

REVOKE ALL ON public.resettle_forward_log FROM PUBLIC, anon;
GRANT SELECT ON public.resettle_forward_log TO authenticated;

-- ── 2. apply_resettle_forward RPC (chips-only, actor = auth.uid()) ─────────────────
CREATE OR REPLACE FUNCTION public.apply_resettle_forward(
  p_tournament_id     uuid,
  p_target_hand_id    uuid,
  p_reason            text,
  p_hand_changes      jsonb,
  p_final_stacks      jsonb,
  p_target_winner_ids jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor    uuid := auth.uid();
  v_reason   text := btrim(COALESCE(p_reason, ''));
  v_hand     RECORD;
  v_club     uuid;
  v_old_sum  bigint := 0;
  v_new_sum  bigint := 0;
  v_before   jsonb;
  v_after    jsonb;
  v_log_id   uuid;
  v_changed  integer := 0;
  v_cur      integer;
  r          jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_reason');
  END IF;
  IF p_final_stacks IS NULL OR jsonb_typeof(p_final_stacks) <> 'array' OR jsonb_array_length(p_final_stacks) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_changes');
  END IF;

  -- Target hand must exist, belong to the tournament, be completed and not voided.
  SELECT * INTO v_hand FROM public.tournament_hands
  WHERE id = p_target_hand_id AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_found');
  END IF;
  IF v_hand.status <> 'completed' OR v_hand.is_voided THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_editable');
  END IF;

  -- Role guard: tracker or floor for the tournament's club.
  SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id;
  IF v_club IS NULL OR NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  -- Lock + validate each affected live chip row; enforce conservation + NO bust flip.
  FOR r IN SELECT * FROM jsonb_array_elements(p_final_stacks) LOOP
    IF (r ->> 'chip_count') IS NULL OR (r ->> 'chip_count')::bigint < 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_stack');
    END IF;

    SELECT chip_count INTO v_cur FROM public.tournament_chip_counts
    WHERE tournament_id = p_tournament_id
      AND player_id = (r ->> 'player_id')::uuid
      AND entry_number = COALESCE((r ->> 'entry_number')::int, 1)
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'player_not_in_tournament');
    END IF;

    -- An alive<->busted flip cannot be a pure chip re-attribution; refuse and route the
    -- caller to the existing void_last_hand + re-enter path (for the latest hand).
    IF (v_cur = 0) <> ((r ->> 'chip_count')::bigint = 0) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'elimination_change_use_void');
    END IF;

    v_old_sum := v_old_sum + v_cur;
    v_new_sum := v_new_sum + (r ->> 'chip_count')::bigint;
  END LOOP;

  IF v_old_sum <> v_new_sum THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_conserved', 'old_sum', v_old_sum, 'new_sum', v_new_sum);
  END IF;

  -- Snapshot BEFORE (only the live chip rows + hand_players endings we will touch).
  SELECT jsonb_build_object(
    'chip_counts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('player_id', tcc.player_id, 'entry_number', tcc.entry_number, 'chip_count', tcc.chip_count))
      FROM public.tournament_chip_counts tcc
      WHERE tcc.tournament_id = p_tournament_id
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_final_stacks) f
                    WHERE (f ->> 'player_id')::uuid = tcc.player_id
                      AND COALESCE((f ->> 'entry_number')::int, 1) = tcc.entry_number)
    ), '[]'::jsonb),
    'hand_players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hand_id', hp.hand_id, 'player_id', hp.player_id, 'entry_number', hp.entry_number, 'ending_stack', hp.ending_stack))
      FROM public.hand_players hp
      WHERE hp.tournament_id = p_tournament_id
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_hand_changes, '[]'::jsonb)) c
                    WHERE (c ->> 'hand_id')::uuid = hp.hand_id
                      AND (c ->> 'player_id')::uuid = hp.player_id
                      AND COALESCE((c ->> 'entry_number')::int, 1) = hp.entry_number)
    ), '[]'::jsonb)
  ) INTO v_before;

  -- Apply historical hand_players.ending_stack corrections (display history only).
  IF p_hand_changes IS NOT NULL AND jsonb_typeof(p_hand_changes) = 'array' THEN
    FOR r IN SELECT * FROM jsonb_array_elements(p_hand_changes) LOOP
      IF (r ->> 'ending_stack') IS NULL OR (r ->> 'ending_stack')::bigint < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bad_hand_change');
      END IF;
      UPDATE public.hand_players
      SET ending_stack = (r ->> 'ending_stack')::int
      WHERE tournament_id = p_tournament_id
        AND hand_id = (r ->> 'hand_id')::uuid
        AND player_id = (r ->> 'player_id')::uuid
        AND entry_number = COALESCE((r ->> 'entry_number')::int, 1);
    END LOOP;
  END IF;

  -- Apply the LIVE final stacks (money) to chip_counts + seats. is_active is left
  -- untouched (no bust flip was allowed), so no elimination trigger fires.
  FOR r IN SELECT * FROM jsonb_array_elements(p_final_stacks) LOOP
    UPDATE public.tournament_chip_counts
    SET chip_count = (r ->> 'chip_count')::int, updated_at = NOW()
    WHERE tournament_id = p_tournament_id
      AND player_id = (r ->> 'player_id')::uuid
      AND entry_number = COALESCE((r ->> 'entry_number')::int, 1);

    -- tournament_seats is UNIQUE(tournament_id, player_id) — one seat row per player,
    -- keyed WITHOUT entry_number — so match on (tournament_id, player_id) only, else a
    -- re-entered player's seat stack would silently no-op and diverge from chip_counts.
    UPDATE public.tournament_seats
    SET chip_count = (r ->> 'chip_count')::int
    WHERE tournament_id = p_tournament_id
      AND player_id = (r ->> 'player_id')::uuid;

    v_changed := v_changed + 1;
  END LOOP;

  -- Snapshot AFTER.
  SELECT jsonb_build_object(
    'chip_counts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('player_id', tcc.player_id, 'entry_number', tcc.entry_number, 'chip_count', tcc.chip_count))
      FROM public.tournament_chip_counts tcc
      WHERE tcc.tournament_id = p_tournament_id
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_final_stacks) f
                    WHERE (f ->> 'player_id')::uuid = tcc.player_id
                      AND COALESCE((f ->> 'entry_number')::int, 1) = tcc.entry_number)
    ), '[]'::jsonb),
    'hand_players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hand_id', hp.hand_id, 'player_id', hp.player_id, 'entry_number', hp.entry_number, 'ending_stack', hp.ending_stack))
      FROM public.hand_players hp
      WHERE hp.tournament_id = p_tournament_id
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_hand_changes, '[]'::jsonb)) c
                    WHERE (c ->> 'hand_id')::uuid = hp.hand_id
                      AND (c ->> 'player_id')::uuid = hp.player_id
                      AND COALESCE((c ->> 'entry_number')::int, 1) = hp.entry_number)
    ), '[]'::jsonb)
  ) INTO v_after;

  INSERT INTO public.resettle_forward_log
    (club_id, tournament_id, target_hand_id, target_hand_number, actor_user_id, reason, target_winner_ids, before, after, changed_players)
  VALUES
    (v_club, p_tournament_id, p_target_hand_id, v_hand.hand_number, v_actor, v_reason,
     COALESCE(p_target_winner_ids, '[]'::jsonb), v_before, v_after, v_changed)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'log_id', v_log_id, 'changed_players', v_changed);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_resettle_forward(uuid, uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_resettle_forward(uuid, uuid, text, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ── Self-verify (run after applying) ──────────────────────────────────────────────
-- select proname from pg_proc where proname = 'apply_resettle_forward';                 -- 1 row
-- select count(*) from information_schema.tables where table_name = 'resettle_forward_log';  -- = 1
-- select has_function_privilege('anon', 'public.apply_resettle_forward(uuid,uuid,text,jsonb,jsonb,jsonb)', 'EXECUTE'); -- = false
