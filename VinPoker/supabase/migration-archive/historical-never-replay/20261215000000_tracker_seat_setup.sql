-- Pre-hand table roster setup — atomic tracker/floor RPC + per-seat avatar column.
--
-- WHY: a TRACKER or FLOOR operator must be able to set up a table's roster before a
-- hand starts — player name + chip count + optional avatar, and add a walk-in to an
-- empty seat. Today `tournament_seats` / `tournament_chip_counts` RLS = owner/cashier
-- ONLY, and a client "update_seats + update_stack" dual-write is (a) blocked for
-- tracker/floor and (b) not atomic (seat.chip_count can desync from the start_hand
-- seed). So one SECURITY DEFINER RPC does ALL writes in one transaction, guarding on
-- tracker/floor/owner/super_admin itself.
--
-- ✅ APPLIED LIVE 2026-07-05 (owner ran it in the Supabase SQL Editor; the storage policy
-- below was rewritten to a text-comparison because `safe_uuid_from_storage_folder` is not
-- in the live DB). Flag `trackerSeatSetup` flipped ON in the same PR. The UI still degrades
-- gracefully (undefined_function 42883 / undefined_column 42703 caught) as a safety net.
--
-- APPLY ORDER / DEPENDS ON (all already live): tournaments, tournament_seats,
-- tournament_chip_counts, tournament_tables, tournament_hands (20260608000001 +
-- 20260807000000), is_club_tracker (20260611000001), is_club_floor (20261025000001),
-- safe_uuid_from_storage_folder + tournament-photos bucket/policies (20261026000000).
--
-- ROLLBACK: docs/emergency_rollbacks/20261215000000_tracker_seat_setup_rollback.sql
-- (DROP POLICY + DROP FUNCTION + DROP COLUMN). Idempotent — safe to re-run.

-- 1. Per-seat avatar (nullable → inert for existing rows; inherits tournament_seats
--    RLS, so no new SELECT policy). The felt/rail already read avatar_url.
ALTER TABLE public.tournament_seats ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. Atomic roster-seat write. SECURITY DEFINER so tracker/floor bypass the
--    owner/cashier-only base-table RLS — the in-body role guard is the real gate
--    (doctrine mirror move_player_seat 20260807000002).
CREATE OR REPLACE FUNCTION public.set_tracker_table_roster_seat(
  p_tournament_id uuid,
  p_table_id uuid,
  p_seat_number integer,
  p_player_name text,
  p_chip_count integer,
  p_existing_player_id uuid DEFAULT NULL,
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
  v_max_seats integer;
  v_name text := btrim(COALESCE(p_player_name, ''));
  v_seat_id uuid;
  v_player_id uuid;
  v_entry integer;
  v_found boolean := false;
BEGIN
  -- Step 0 — bind the actor to the AUTHENTICATED caller. A SECURITY DEFINER function
  -- must NEVER trust a caller-supplied actor id: without this, any authenticated user
  -- could pass a known tracker/owner UUID and pass the role guard below. This is the
  -- exact vuln class fixed for confirm_registration_and_assign_seat (P0 guard v2,
  -- 20260811000000) and move_player_seat (guard v2, 20260818000000). The only caller is
  -- the tracker/floor UI passing user.id under the user's JWT, so for a legitimate call
  -- p_actor_user_id already equals auth.uid().
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_actor := p_actor_user_id;

  -- Resolve club.
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  -- Role guard: tracker OR floor (each already includes owner + super_admin).
  IF NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  -- Table belongs to the tournament. Drift-tolerant: accept p_table_id whether it is
  -- tournament_tables.id or tournament_tables.table_id (the game_tables ref) — the
  -- tracker passes the get_tournament_tables value, same as add_player. Also allow a
  -- table already carrying seats for this tournament (fresh-table edge).
  SELECT tt.max_seats INTO v_max_seats
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id AND (tt.id = p_table_id OR tt.table_id = p_table_id)
  LIMIT 1;
  IF v_max_seats IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tournament_seats s
      WHERE s.tournament_id = p_tournament_id AND s.table_id = p_table_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'table_mismatch');
    END IF;
    v_max_seats := 10;
  END IF;

  -- Pre-hand only: never mutate the roster while a hand is live on this table.
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id AND h.table_id = p_table_id AND h.status = 'in_progress'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_in_progress');
  END IF;

  -- Validate inputs.
  IF p_seat_number < 1 OR p_seat_number > COALESCE(v_max_seats, 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_seat_number');
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_player_name');
  END IF;
  IF p_chip_count IS NULL OR p_chip_count < 0 OR p_chip_count > 1000000000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_chip_count');
  END IF;
  -- Avatar (only when touching + non-null): must be OUR uploaded storage object — a
  -- tournament-photos PUBLIC URL under THIS tournament's seat-avatars folder, no
  -- query/fragment. Anchored to scheme + host + the canonical storage object path so a
  -- URL that merely EMBEDS the fragment (e.g. https://evil/?x=/tournament-photos/<tid>/
  -- seat-avatars/y.jpg) is rejected — the old position()>0 substring test let it through.
  -- p_tournament_id::text is a UUID (hex + hyphens) so it is regex-safe to interpolate.
  IF p_touch_avatar AND p_avatar_url IS NOT NULL AND p_avatar_url !~ (
    '^https://[^/]+/storage/v1/object/public/tournament-photos/'
    || p_tournament_id::text || '/seat-avatars/[^?#]+$'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_avatar_url');
  END IF;

  -- Upsert the seat by EXACT table identity (never tournament_id + seat_number alone —
  -- many tables share seat 1). Existing active seat → UPDATE (keep player_id/entry);
  -- else INSERT a walk-in (random UUID unless an existing player_id is supplied).
  SELECT s.id, s.player_id, s.entry_number INTO v_seat_id, v_player_id, v_entry
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id AND s.table_id = p_table_id
    AND s.seat_number = p_seat_number AND s.is_active = true
  LIMIT 1;
  v_found := FOUND;

  IF v_found THEN
    UPDATE public.tournament_seats SET
      player_name = v_name,
      chip_count = p_chip_count,
      avatar_url = CASE WHEN p_touch_avatar THEN p_avatar_url ELSE avatar_url END
    WHERE id = v_seat_id;
  ELSE
    -- No active seat at this identity. If the caller supplied an existing player_id it
    -- was editing a seat that has since been removed (stale client) — do NOT silently
    -- re-insert that player as a walk-in: it would collide with their live seat
    -- elsewhere (uq_tournament_seats_active_player) or resurrect a busted player. Ask
    -- them to reload instead.
    IF p_existing_player_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_gone');
    END IF;
    v_player_id := gen_random_uuid();
    v_entry := 1;  -- fresh walk-in id → no prior entries for this player
    BEGIN
      INSERT INTO public.tournament_seats
        (tournament_id, player_id, table_id, seat_number, entry_number, chip_count, is_active, player_name, avatar_url)
      VALUES
        (p_tournament_id, v_player_id, p_table_id, p_seat_number, v_entry, p_chip_count, true, v_name,
         CASE WHEN p_touch_avatar THEN p_avatar_url ELSE NULL END)
      RETURNING id INTO v_seat_id;
    EXCEPTION WHEN unique_violation THEN
      -- Another operator filled this (table_id, seat_number) concurrently.
      RETURN jsonb_build_object('ok', false, 'error', 'seat_conflict');
    END;
  END IF;

  -- Same transaction: write tournament_chip_counts (the PRIMARY term start_hand seeds
  -- from) so the pre-hand stack can never desync from what the felt shows.
  INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
  VALUES (p_tournament_id, v_player_id, v_entry, p_chip_count)
  ON CONFLICT (tournament_id, player_id, entry_number)
  DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'seat', jsonb_build_object(
    'id', v_seat_id,
    'player_id', v_player_id,
    'seat_number', p_seat_number,
    'player_name', v_name,
    'chip_count', p_chip_count,
    'avatar_url', (SELECT avatar_url FROM public.tournament_seats WHERE id = v_seat_id),
    'entry_number', v_entry
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_tracker_table_roster_seat(uuid, uuid, integer, text, integer, uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tracker_table_roster_seat(uuid, uuid, integer, text, integer, uuid, boolean, text, uuid) TO authenticated, service_role;

-- 3. Storage: let a TRACKER upload seat avatars (the existing tournament-photos INSERT
--    policy is floor/media only). ADDITIVE + scoped to the `seat-avatars` subfolder, so
--    it widens tracker rights ONLY for seat avatars, not general tournament photos. The
--    tournament_id is foldername[1]; seat-avatars is [2].
--    NOTE: `safe_uuid_from_storage_folder` is NOT in the live DB (schema drift), so we
--    match the tournament by TEXT (t.id::text = foldername[1]) — no ::uuid cast (which
--    would error on non-UUID folder names in the shared bucket). Applied live 2026-07-05.
DO $$ BEGIN
  CREATE POLICY "tournament_photos_obj_insert_tracker_seatavatar" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'tournament-photos'
      AND (storage.foldername(name))[2] = 'seat-avatars'
      AND EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id::text = (storage.foldername(name))[1]
          AND public.is_club_tracker(auth.uid(), t.club_id)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Self-verify (run manually in the apply session — illustrative, do NOT auto-run).
--    NOTE: the RPC now BINDS p_actor_user_id to auth.uid() (Step 0). A raw SQL call in
--    the apply session runs as postgres/service_role where auth.uid() IS NULL, so it
--    returns {ok:false,error:'actor_not_allowed'} — that is itself proof the guard is
--    live. Functional read/write verification must go through the app under a real
--    tracker/floor JWT (or a session that sets request.jwt.claim.sub).
-- SECURITY CHECKS (mirror P0/move guard v2):
--   * anon / no-JWT call                       → actor_not_allowed
--   * authenticated call with a SPOOFED actor  → actor_not_allowed
--   * legitimate tracker/floor call (own JWT)  → ok
--   * external avatar URL (embeds fragment)    → bad_avatar_url
--   * grants: SELECT grantee FROM information_schema.routine_privileges
--       WHERE routine_name='set_tracker_table_roster_seat'; → authenticated + service_role only
-- FUNCTIONAL (via app / JWT session, then ROLLBACK):
--   -- SELECT set_tracker_table_roster_seat(:tid,:table,1,'TEST · Verify',5000000,NULL,false,NULL,auth.uid());
--   -- SELECT player_name, chip_count FROM tournament_seats WHERE tournament_id=:tid AND table_id=:table AND seat_number=1 AND is_active;
--   -- SELECT chip_count FROM tournament_chip_counts WHERE tournament_id=:tid AND chip_count=5000000;
-- TABLE IDENTITY (owner-requested): two tables both using seat 1 must NOT collide.
--   -- call with (:tidA=table A, seat 1, 'A-one') then (:tidB=table B, seat 1, 'B-one');
--   -- SELECT table_id, player_name FROM tournament_seats
--   --   WHERE tournament_id=:tid AND seat_number=1 AND is_active ORDER BY table_id;
--   -- EXPECT two distinct rows (A-one on table A, B-one on table B) — writes keyed on
--   -- (tournament_id, table_id, seat_number), never seat_number alone.
