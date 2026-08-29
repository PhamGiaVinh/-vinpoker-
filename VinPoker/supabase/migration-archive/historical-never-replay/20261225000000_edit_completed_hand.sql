-- ĐỢT F2 — Edit a COMPLETED hand (DISPLAY-ONLY) + immutable audit + void_last_hand guard.
--
-- WHY: operators sometimes discover a wrong board card / hole card / action in a hand
-- that already finished. There is no safe write path today: update_community_cards &
-- record_action reject status != 'in_progress'; re-running record_hand CLOBBERS live
-- chip counts / seats / eliminations / aggregates and silently drops action edits. So a
-- new, narrow, DISPLAY-ONLY RPC is required.
--
-- HARD DOCTRINE (owner-locked): this edits ONLY what is shown — tournament_hands.
-- community_cards + hand_players.hole_cards + the hand_actions rows. It NEVER touches
-- money/results: tournament_chip_counts, tournament_seats, tournament_eliminations,
-- hand_players.starting_stack/ending_stack/is_eliminated/side_pots, or
-- tournaments.players_remaining/average_stack ("saved values never recompute"). Money
-- errors on the LATEST hand stay a void + re-enter job (see the void guard below).
--
-- SECURITY (owner-locked): the actor is bound to auth.uid() INSIDE the function — there
-- is NO client actor parameter to trust. anon/public are refused (grants + a null-auth
-- check). SECURITY DEFINER SET search_path = public. Every edit writes an IMMUTABLE
-- hand_edit_log row (before/after full snapshot + actor + reason) — never updated.
--
-- ⚠️ NOT APPLIED. Production apply is OWNER-GATED (vinpoker-production-patch runbook),
-- in a separate controlled session, after PR-green + owner review + smoke. This migration
-- touches NO money columns, but it CREATE-OR-REPLACEs void_last_hand (money-path) — the
-- diff is additive (only the new guard). Rollback: DROP the two new objects and re-apply
-- 20261014000000's void_last_hand definition.

-- ── 1. Immutable audit log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hand_edit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id  uuid NOT NULL,
  table_id       uuid,
  hand_id        uuid NOT NULL,
  hand_number    integer,
  actor_user_id  uuid NOT NULL,   -- = auth.uid(), set by the RPC (never from client)
  reason         text NOT NULL,
  before         jsonb NOT NULL,  -- {board, hole_cards:[{player_id,entry_number,hole_cards}], actions:[...], pot_size, side_pots}
  after          jsonb NOT NULL,  -- same shape
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hand_edit_log_hand ON public.hand_edit_log (hand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hand_edit_log_club ON public.hand_edit_log (club_id, created_at DESC);

ALTER TABLE public.hand_edit_log ENABLE ROW LEVEL SECURITY;

-- SELECT only — tracker/floor/owner/super_admin. There is deliberately NO insert/update/
-- delete policy: the ONLY writer is the SECURITY DEFINER RPC below (definer bypasses RLS),
-- and the row can never be updated or deleted → immutable audit trail.
DROP POLICY IF EXISTS "hand_edit_log readable by tracker/floor" ON public.hand_edit_log;
CREATE POLICY "hand_edit_log readable by tracker/floor" ON public.hand_edit_log
  FOR SELECT TO authenticated
  USING (public.is_club_tracker(auth.uid(), club_id) OR public.is_club_floor(auth.uid(), club_id));

REVOKE ALL ON public.hand_edit_log FROM PUBLIC, anon;
GRANT SELECT ON public.hand_edit_log TO authenticated;

-- ── 2. edit_completed_hand RPC (DISPLAY-ONLY, actor = auth.uid()) ─────────────
-- PATCH semantics: a NULL param means "don't touch that section".
CREATE OR REPLACE FUNCTION public.edit_completed_hand(
  p_tournament_id   uuid,
  p_hand_id         uuid,
  p_reason          text,
  p_community_cards jsonb   DEFAULT NULL,
  p_hole_cards      jsonb   DEFAULT NULL,  -- [{player_id, entry_number, hole_cards:[..]}]
  p_actions         jsonb   DEFAULT NULL,  -- full replacement stream (or NULL = keep)
  p_pot_size        integer DEFAULT NULL,  -- display pot, client-recomputed; only with p_actions
  p_side_pots       jsonb   DEFAULT NULL   -- display layers, client-recomputed; only with p_actions
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor    uuid := auth.uid();   -- bound internally; NEVER trust a client actor
  v_reason   text := btrim(COALESCE(p_reason, ''));
  v_hand     RECORD;
  v_club     uuid;
  v_eff_board jsonb;
  v_total    integer;
  v_distinct integer;
  v_actsum   bigint;
  v_before   jsonb;
  v_after    jsonb;
  v_log_id   uuid;
  v_row      jsonb;
BEGIN
  -- Actor: refuse anon/public (grants also REVOKE anon).
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_reason');
  END IF;

  -- Lock the hand; must be a completed, non-voided hand of this tournament.
  SELECT * INTO v_hand FROM public.tournament_hands
  WHERE id = p_hand_id AND tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_found');
  END IF;
  IF v_hand.status <> 'completed' OR v_hand.is_voided THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_editable');
  END IF;

  -- Role guard (tracker/floor already include owner + super_admin).
  SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id;
  IF v_club IS NULL OR NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  -- Serialize against a concurrent void / second editor.
  PERFORM 1 FROM public.hand_players WHERE hand_id = p_hand_id FOR UPDATE;
  PERFORM 1 FROM public.hand_actions WHERE hand_id = p_hand_id FOR UPDATE;

  -- Board validation.
  IF p_community_cards IS NOT NULL THEN
    IF public.validate_cards(p_community_cards) <> 'ok' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_board');
    END IF;
    IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'bad_board_count');
    END IF;
  END IF;

  -- Hole-card validation (only listed players; each must exist in this hand).
  IF p_hole_cards IS NOT NULL THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_hole_cards) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.hand_players
        WHERE hand_id = p_hand_id
          AND player_id = (v_row ->> 'player_id')::uuid
          AND entry_number = COALESCE((v_row ->> 'entry_number')::int, 1)
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'player_not_in_hand');
      END IF;
      IF public.validate_cards(v_row -> 'hole_cards') <> 'ok' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_hole');
      END IF;
      IF jsonb_array_length(COALESCE(v_row -> 'hole_cards', '[]'::jsonb)) NOT IN (0, 2) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bad_hole_count');
      END IF;
    END LOOP;
  END IF;

  -- Cross-uniqueness over the EFFECTIVE board ∪ all players' EFFECTIVE holes.
  v_eff_board := COALESCE(p_community_cards, v_hand.community_cards, '[]'::jsonb);
  WITH eff_holes AS (
    SELECT COALESCE(
      (SELECT e -> 'hole_cards'
         FROM jsonb_array_elements(COALESCE(p_hole_cards, '[]'::jsonb)) e
        WHERE (e ->> 'player_id')::uuid = hp.player_id
          AND COALESCE((e ->> 'entry_number')::int, 1) = hp.entry_number
        LIMIT 1),
      hp.hole_cards, '[]'::jsonb
    ) AS holes
    FROM public.hand_players hp WHERE hp.hand_id = p_hand_id
  ),
  all_cards AS (
    SELECT jsonb_array_elements_text(v_eff_board) AS c
    UNION ALL
    SELECT jsonb_array_elements_text(holes) FROM eff_holes
  )
  SELECT COUNT(*), COUNT(DISTINCT c) INTO v_total, v_distinct FROM all_cards;
  IF v_total <> v_distinct THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_card');
  END IF;

  -- Action validation (when replacing).
  IF p_actions IS NOT NULL THEN
    IF jsonb_array_length(p_actions) > 500 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'too_many_actions');
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_actions) e
      WHERE COALESCE(e ->> 'street', 'preflop') NOT IN ('preflop','flop','turn','river','showdown')
         OR COALESCE((e ->> 'action_order')::int, 0) < 1
         OR COALESCE((e ->> 'action_amount')::int, 0) < 0
         OR e ->> 'action_type' IS NULL
         OR length(e ->> 'action_type') = 0
         OR length(e ->> 'action_type') > 24
         OR NOT EXISTS (
              SELECT 1 FROM public.hand_players hp
              WHERE hp.hand_id = p_hand_id
                AND hp.player_id = (e ->> 'player_id')::uuid
                AND hp.entry_number = COALESCE((e ->> 'entry_number')::int, 1)
            )
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
    END IF;
    -- action_order must be distinct within the payload.
    SELECT COUNT(*), COUNT(DISTINCT (e ->> 'action_order')::int) INTO v_total, v_distinct
    FROM jsonb_array_elements(p_actions) e;
    IF v_total <> v_distinct THEN
      RETURN jsonb_build_object('ok', false, 'error', 'duplicate_action_order');
    END IF;

    -- Pot coupling: pot only WITH actions; display bound 0 ≤ pot ≤ Σ action_amounts.
    IF p_pot_size IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_pot');
    END IF;
    SELECT COALESCE(SUM((e ->> 'action_amount')::bigint), 0) INTO v_actsum
    FROM jsonb_array_elements(p_actions) e;
    IF p_pot_size < 0 OR p_pot_size > v_actsum THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pot_mismatch');
    END IF;
  ELSIF p_pot_size IS NOT NULL OR p_side_pots IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pot_without_actions');
  END IF;

  -- Snapshot BEFORE.
  SELECT jsonb_build_object(
    'board', v_hand.community_cards,
    'pot_size', v_hand.pot_size,
    'side_pots', v_hand.side_pots,
    'hole_cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'player_id', hp.player_id, 'entry_number', hp.entry_number, 'hole_cards', hp.hole_cards))
      FROM public.hand_players hp WHERE hp.hand_id = p_hand_id), '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'player_id', ha.player_id, 'entry_number', ha.entry_number, 'street', ha.street,
        'action_type', ha.action_type, 'action_amount', ha.action_amount, 'action_order', ha.action_order)
        ORDER BY ha.action_order)
      FROM public.hand_actions ha WHERE ha.hand_id = p_hand_id), '[]'::jsonb)
  ) INTO v_before;

  -- APPLY — display columns only.
  UPDATE public.tournament_hands
  SET community_cards = COALESCE(p_community_cards, community_cards),
      pot_size        = COALESCE(p_pot_size, pot_size),
      side_pots       = COALESCE(p_side_pots, side_pots),
      updated_at      = NOW()
  WHERE id = p_hand_id;

  IF p_hole_cards IS NOT NULL THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_hole_cards) LOOP
      -- UPDATE the hole_cards column ONLY — never DELETE/INSERT hand_players rows
      -- (preserves E1 player_name/avatar snapshot + all stack/elim columns).
      UPDATE public.hand_players
      SET hole_cards = COALESCE(v_row -> 'hole_cards', '[]'::jsonb)
      WHERE hand_id = p_hand_id
        AND player_id = (v_row ->> 'player_id')::uuid
        AND entry_number = COALESCE((v_row ->> 'entry_number')::int, 1);
    END LOOP;
  END IF;

  IF p_actions IS NOT NULL THEN
    -- Full replace; the client action_order values are inserted VERBATIM — gaps left by a
    -- deleted row are preserved, surviving rows are NEVER renumbered (order is a sort key).
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    INSERT INTO public.hand_actions
      (hand_id, player_id, entry_number, street, action_type, action_amount, action_order)
    SELECT p_hand_id,
      (e ->> 'player_id')::uuid,
      COALESCE((e ->> 'entry_number')::int, 1),
      COALESCE(e ->> 'street', 'preflop'),
      e ->> 'action_type',
      COALESCE((e ->> 'action_amount')::int, 0),
      (e ->> 'action_order')::int
    FROM jsonb_array_elements(p_actions) e;
  END IF;

  -- Snapshot AFTER.
  SELECT jsonb_build_object(
    'board', th.community_cards, 'pot_size', th.pot_size, 'side_pots', th.side_pots,
    'hole_cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'player_id', hp.player_id, 'entry_number', hp.entry_number, 'hole_cards', hp.hole_cards))
      FROM public.hand_players hp WHERE hp.hand_id = p_hand_id), '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'player_id', ha.player_id, 'entry_number', ha.entry_number, 'street', ha.street,
        'action_type', ha.action_type, 'action_amount', ha.action_amount, 'action_order', ha.action_order)
        ORDER BY ha.action_order)
      FROM public.hand_actions ha WHERE ha.hand_id = p_hand_id), '[]'::jsonb)
  ) INTO v_after
  FROM public.tournament_hands th WHERE th.id = p_hand_id;

  INSERT INTO public.hand_edit_log
    (club_id, tournament_id, table_id, hand_id, hand_number, actor_user_id, reason, before, after)
  VALUES
    (v_club, p_tournament_id, v_hand.table_id, p_hand_id, v_hand.hand_number, v_actor, v_reason, v_before, v_after)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'log_id', v_log_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.edit_completed_hand(uuid, uuid, text, jsonb, jsonb, jsonb, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_completed_hand(uuid, uuid, text, jsonb, jsonb, jsonb, integer, jsonb) TO authenticated, service_role;

-- SELF-VERIFY (owner runs these in the gated apply session):
--   • anon/logged-out call → {ok:false, error:'not_authenticated'} (auth.uid() null).
--   • non-tracker/floor member → {ok:false, error:'actor_not_authorized'}.
--   • in_progress or voided hand → {ok:false, error:'hand_not_editable'}.
--   • board reused in a hole card → {ok:false, error:'duplicate_card'}.
--   • MONEY SAFETY: before/after a call, tournament_chip_counts + tournament_seats +
--     tournament_eliminations + hand_players.ending_stack/is_eliminated are UNCHANGED;
--     exactly one hand_edit_log row appears; UPDATE/DELETE on hand_edit_log as
--     authenticated fails (no policy).

-- ── 3. void_last_hand — add the last-hand guard (history safety, bundled here) ─
-- Body byte-identical to 20261014000000 EXCEPT the guard after the is_voided check:
-- block the CHIP-RESTORING (completed) branch when a NEWER non-voided completed/
-- in_progress hand exists on the same (tournament_id, table_id) — voiding a mid-history
-- hand would restore stale starting_stack over LIVE chip counts. Scoped to
-- status='completed' so voiding the newest completed hand / the current in_progress hand
-- / an old orphan in_progress hand all still work. Rollback = re-apply 20261014000000.
CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tournament_id UUID;
  v_hand_record RECORD;
  v_player_record RECORD;
BEGIN
  SELECT * INTO v_hand_record FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_hand_record.is_voided THEN
    RETURN jsonb_build_object('error', 'Hand already voided');
  END IF;

  v_tournament_id := v_hand_record.tournament_id;

  -- F2 GUARD: never void a mid-history COMPLETED hand — restoring its pre-hand chip
  -- snapshot would overwrite the live chip counts that later hands already advanced.
  IF v_hand_record.status = 'completed' AND EXISTS (
    SELECT 1 FROM public.tournament_hands h2
    WHERE h2.tournament_id = v_hand_record.tournament_id
      AND h2.table_id = v_hand_record.table_id
      AND h2.id <> p_hand_id
      AND h2.is_voided = false
      AND h2.status IN ('completed', 'in_progress')
      AND h2.hand_number > v_hand_record.hand_number
  ) THEN
    RETURN jsonb_build_object('error',
      'Không thể void ván này — đã có ván mới hơn trên bàn. Chỉ void được ván mới nhất (nếu không chip sẽ sai).');
  END IF;

  -- Only restore chip if hand was completed (has ending_stack)
  IF v_hand_record.status = 'completed' THEN
    FOR v_player_record IN
      SELECT * FROM public.hand_players WHERE hand_id = p_hand_id
    LOOP
      UPDATE public.tournament_chip_counts
      SET chip_count = v_player_record.starting_stack, updated_at = NOW()
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;

      UPDATE public.tournament_seats AS t
      SET chip_count = v_player_record.starting_stack,
          is_active = CASE
            WHEN EXISTS (
              SELECT 1 FROM public.tournament_seats s2
              WHERE s2.tournament_id = v_tournament_id
                AND s2.player_id = v_player_record.player_id
                AND s2.is_active = true
                AND s2.id <> t.id
            ) THEN t.is_active
            ELSE true
          END
      WHERE t.tournament_id = v_tournament_id
        AND t.player_id = v_player_record.player_id
        AND t.entry_number = v_player_record.entry_number;
    END LOOP;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
  END IF;

  -- For in_progress hands: delete orphan actions + reset hole_cards
  IF v_hand_record.status = 'in_progress' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
    UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false WHERE hand_id = p_hand_id;
  END IF;

  UPDATE public.tournament_hands
  SET is_voided = true, status = 'voided',
      locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
  WHERE id = p_hand_id;

  UPDATE public.tournaments
  SET players_remaining = (
      SELECT COUNT(*) FROM public.tournament_seats WHERE tournament_id = v_tournament_id AND is_active = true
    ),
    average_stack = (
      SELECT COALESCE(AVG(chip_count), 0) FROM public.tournament_chip_counts WHERE tournament_id = v_tournament_id
    ),
    updated_at = NOW()
  WHERE id = v_tournament_id;

  RETURN jsonb_build_object('status', 'success', 'message', 'Hand voided successfully', 'hand_id', p_hand_id);
END;
$$;
