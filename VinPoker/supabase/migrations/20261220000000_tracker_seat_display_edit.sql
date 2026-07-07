-- Mid-hand DISPLAY-ONLY seat edit — tracker/floor may fix a player's NAME or AVATAR
-- while a hand is in progress, WITHOUT touching chips.
--
-- WHY: set_tracker_table_roster_seat (20261215000000) blocks ALL roster edits while a
-- hand is `in_progress` (the `hand_in_progress` guard) because it writes chips, and a
-- mid-hand chip change cannot survive: start_hand snapshots each player's starting_stack
-- into hand_players, record_hand settles FROM that snapshot and OVERWRITES
-- tournament_chip_counts, and void_last_hand restores the pre-hand snapshot — so a
-- mid-hand tournament_seats.chip_count write is silently lost / contradicts live pot math.
-- Therefore chip edits STAY blocked mid-hand (recovery = finish/void the hand, then the
-- existing ChipQuickEditPanel). But a NAME/AVATAR fix is pure felt display — zero money
-- impact — and today it forces the operator to VOID the whole hand over a typo.
--
-- This adds a SEPARATE, deliberately narrow SECURITY DEFINER RPC that edits ONLY
-- player_name + avatar_url of an EXISTING active seat. It never inserts a seat, never
-- changes player_id/entry_number, never reads or writes any chip column, and — unlike
-- the roster RPC — it is allowed while a hand is in progress. Keeping it a separate
-- function (not a p_display_only branch on the live money-path RPC) means the applied,
-- money-critical set_tracker_table_roster_seat is never re-created, and the client can
-- feature-detect this one independently (42883 → degrade).
--
-- SOURCE-ONLY — owner applies in the Supabase SQL Editor in a gated session. The UI
-- degrades gracefully (undefined_function 42883 caught) until then, and the mid-hand
-- editor is behind the `trackerMidHandEdit` flag (default OFF) so a merge is inert.
--
-- DEPENDS ON (all already live): tournaments, tournament_seats, tournament_tables,
-- tournament_hands, is_club_tracker (20260611000001), is_club_floor (20261025000001),
-- and set_tracker_table_roster_seat (20261215000000, for the avatar column + the
-- tournament-photos storage upload policy — this migration adds NO storage policy).
--
-- ROLLBACK: DROP FUNCTION public.set_tracker_seat_display(uuid, uuid, integer, text,
-- boolean, text, uuid);  -- idempotent, safe to re-run.

CREATE OR REPLACE FUNCTION public.set_tracker_seat_display(
  p_tournament_id uuid,
  p_table_id uuid,
  p_seat_number integer,
  p_player_name text,
  p_touch_avatar boolean DEFAULT false,
  p_avatar_url text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_club uuid;
  v_name text := btrim(COALESCE(p_player_name, ''));
  v_seat_id uuid;
  v_old_name text;
BEGIN
  -- Step 0 — bind the actor to the AUTHENTICATED caller. A SECURITY DEFINER function
  -- must NEVER trust a caller-supplied actor id (exact guard from
  -- set_tracker_table_roster_seat 20261215000000:57-66). The only caller is the
  -- tracker/floor UI passing user.id under the user's JWT.
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_actor := p_actor_user_id;

  -- Resolve club.
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  -- Role guard: tracker OR floor (each already includes owner + super_admin). Kept as a
  -- caught jsonb error (not a raised exception) so a missing helper surfaces as 42883 in
  -- the UI degrade path rather than a hard 500.
  IF NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  -- Validate inputs (name always; avatar only when touching + non-null — the same
  -- anchored tournament-photos/<tid>/seat-avatars regex as the roster RPC, so a URL that
  -- merely EMBEDS the fragment is rejected). p_tournament_id::text is UUID → regex-safe.
  IF char_length(v_name) < 1 OR char_length(v_name) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_player_name');
  END IF;
  IF p_touch_avatar AND p_avatar_url IS NOT NULL AND p_avatar_url !~ (
    '^https://[^/]+/storage/v1/object/public/tournament-photos/'
    || p_tournament_id::text || '/seat-avatars/[^?#]+$'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_avatar_url');
  END IF;

  -- Target an EXISTING active seat by EXACT table identity (never seat_number alone —
  -- many tables share seat 1). Drift-tolerant table match copied from the roster RPC.
  -- NO insert path: a display edit can never create a seat or change player_id/entry.
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id AND (tt.id = p_table_id OR tt.table_id = p_table_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id AND s.table_id = p_table_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_mismatch');
  END IF;

  SELECT s.id, s.player_name INTO v_seat_id, v_old_name
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id AND s.table_id = p_table_id
    AND s.seat_number = p_seat_number AND s.is_active = true
  LIMIT 1;
  IF v_seat_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_found');
  END IF;

  -- Display-only write: name + (optionally) avatar. Deliberately NO hand_in_progress
  -- guard, NO chip_count column, NO tournament_chip_counts touch.
  UPDATE public.tournament_seats SET
    player_name = v_name,
    avatar_url = CASE WHEN p_touch_avatar THEN p_avatar_url ELSE avatar_url END
  WHERE id = v_seat_id;

  RETURN jsonb_build_object('ok', true, 'old_name', v_old_name, 'seat', jsonb_build_object(
    'id', v_seat_id,
    'seat_number', p_seat_number,
    'player_name', v_name,
    'avatar_url', (SELECT avatar_url FROM public.tournament_seats WHERE id = v_seat_id)
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_tracker_seat_display(uuid, uuid, integer, text, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tracker_seat_display(uuid, uuid, integer, text, boolean, text, uuid) TO authenticated, service_role;

-- Self-verify (run manually in the apply session — illustrative, do NOT auto-run).
-- As with the roster RPC, a raw SQL call runs as postgres/service_role where auth.uid()
-- IS NULL, so it returns {ok:false,error:'actor_not_allowed'} — itself proof the Step-0
-- guard is live. Functional verification goes through the app under a real tracker/floor JWT.
-- SECURITY CHECKS:
--   * anon / no-JWT call                       → actor_not_allowed
--   * authenticated call with a SPOOFED actor  → actor_not_allowed
--   * legitimate tracker/floor call (own JWT)  → ok
--   * external avatar URL (embeds fragment)    → bad_avatar_url
--   * grants: SELECT grantee FROM information_schema.routine_privileges
--       WHERE routine_name='set_tracker_seat_display'; → authenticated + service_role only
-- MONEY-SAFETY (the whole point):
--   * while a hand is in_progress, set_tracker_seat_display(...,'Sửa Tên',...) → ok,
--     AND set_tracker_table_roster_seat(... same table ...) → hand_in_progress (chips stay locked)
--   * after a display edit, the seat's tournament_chip_counts row is UNCHANGED (no chip write).
