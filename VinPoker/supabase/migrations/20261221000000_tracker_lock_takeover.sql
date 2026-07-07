-- Multi-table lock handoff — explicit takeover of a stale hand lock + a read-only
-- "who holds which table" query for the operator's table picker.
--
-- WHY: today one tracker = one table. The heartbeat lock (heartbeat_lock, 5-min TTL via
-- tracker_lock_ttl) already CLAIMS the hand and every mutating RPC (record_action,
-- update_community_cards, show_hole_cards, delete_last_action) refuses writes from a
-- different user while the lock is FRESH (tracker_lock_blocks). But there is no explicit
-- "take over this table" action and no way to SEE who holds a locked table — a second
-- tracker on a shift change can only wait out the 5-minute TTL or refresh blindly.
--
-- This adds:
--   1) takeover_hand_lock(hand_id, force, actor) — claim a hand's lock when it is NULL /
--      self-owned / STALE (older than the TTL), or when a FLOOR operator forces it.
--   2) get_tracker_table_locks(tournament_id, actor) — read-only, names the holder.
-- Neither touches chips / hand_actions — the money path is untouched. Two-writer safety
-- rides entirely on the EXISTING tracker_lock_blocks check inside the write RPCs + the
-- FOR UPDATE row lock: whichever of {takeover, a competing write} commits first wins,
-- the other then sees a fresh lock owned by someone else and is refused.
--
-- SOURCE-ONLY — owner applies in a gated SQL Editor session.
-- ⚠ MANDATORY PRE-CHECK before enabling the `trackerMultiTable` flag: the live
--   record_action MUST already enforce the lock (migration 20260928000000 applied).
--   Verify:  SELECT prosrc LIKE '%tracker_lock_blocks%' AS lock_enforced
--            FROM pg_proc WHERE proname = 'record_action';
--   If false, apply 20260928000000 FIRST — otherwise takeover flips the owner but the
--   old console's writes still land (true two-writer corruption).
--
-- DEPENDS ON (all already live if 20260928000000 is applied): tournament_hands
-- (locked_by_user_id, locked_at), tournaments, profiles, is_club_tracker
-- (20260611000001), is_club_floor (20261025000001).
--
-- ROLLBACK:
--   DROP FUNCTION public.takeover_hand_lock(uuid, boolean, uuid);
--   DROP FUNCTION public.get_tracker_table_locks(uuid, uuid);
--   (leave tracker_lock_ttl / tracker_lock_blocks — they belong to 20260928000000.)

-- 0. Defensive re-create of the TTL helpers (idempotent, byte-identical to
--    20260928000000) so this migration is self-contained even if applied first. If
--    20260928000000 is already live these are no-ops.
CREATE OR REPLACE FUNCTION public.tracker_lock_ttl()
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT INTERVAL '5 minutes'
$$;

CREATE OR REPLACE FUNCTION public.tracker_lock_blocks(
  p_locked_by uuid,
  p_locked_at timestamptz,
  p_user_id uuid
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user_id IS NOT NULL
     AND p_locked_by IS NOT NULL
     AND p_locked_by <> p_user_id
     AND p_locked_at IS NOT NULL
     AND p_locked_at > now() - public.tracker_lock_ttl()
$$;

-- 1. Explicit takeover. Non-forced: only a NULL / self / STALE lock (mirrors the
--    heartbeat_lock claim condition) — a healthy holder is NOT displaced. Forced:
--    additionally requires the actor to be FLOOR (the only path that can displace a
--    fresh writer, e.g. an urgent shift change). Never touches chips/hand_actions.
CREATE OR REPLACE FUNCTION public.takeover_hand_lock(
  p_hand_id uuid,
  p_force boolean DEFAULT false,
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
  v_status text;
  v_locked_by uuid;
  v_locked_at timestamptz;
  v_is_floor boolean;
BEGIN
  -- Step 0 — bind actor to auth.uid() (never trust a client-supplied id).
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_actor := p_actor_user_id;

  -- Resolve club from the hand's tournament + FOR UPDATE serialize with writers/takeovers.
  SELECT t.club_id, h.status, h.locked_by_user_id, h.locked_at
    INTO v_club, v_status, v_locked_by, v_locked_at
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_found');
  END IF;

  v_is_floor := public.is_club_floor(v_actor, v_club);
  IF NOT (public.is_club_tracker(v_actor, v_club) OR v_is_floor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  IF v_status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;

  -- Forcing requires floor. A non-forced takeover of a FRESH other-owner lock is refused.
  IF p_force AND NOT v_is_floor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'force_requires_floor');
  END IF;

  IF NOT p_force AND public.tracker_lock_blocks(v_locked_by, v_locked_at, v_actor) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'lock_fresh',
      'locked_by', v_locked_by,
      'age_seconds', floor(extract(epoch FROM (now() - v_locked_at)))
    );
  END IF;

  UPDATE public.tournament_hands
  SET locked_by_user_id = v_actor, locked_at = now(), updated_at = now()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object(
    'ok', true,
    'previous_locked_by', v_locked_by,
    'forced', p_force AND v_locked_by IS NOT NULL AND v_locked_by <> v_actor
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.takeover_hand_lock(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.takeover_hand_lock(uuid, boolean, uuid) TO authenticated, service_role;

-- 2. Read-only lock map for the tournament's in-progress hands. SECURITY DEFINER so it
--    can resolve the holder's display_name without widening profiles RLS; the in-body
--    role guard (tracker∪floor) is the real gate.
CREATE OR REPLACE FUNCTION public.get_tracker_table_locks(
  p_tournament_id uuid,
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
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_actor := p_actor_user_id;

  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'table_id', h.table_id,
      'hand_id', h.id,
      'locked_by_user_id', h.locked_by_user_id,
      'locked_by_name', COALESCE(pr.display_name, 'Người dùng khác'),
      'is_self', h.locked_by_user_id = v_actor,
      'heartbeat_age_seconds',
        CASE WHEN h.locked_at IS NULL THEN NULL
             ELSE floor(extract(epoch FROM (now() - h.locked_at))) END,
      'is_stale',
        h.locked_by_user_id IS NULL OR h.locked_at IS NULL
        OR h.locked_at <= now() - public.tracker_lock_ttl()
    ) AS row
    FROM public.tournament_hands h
    LEFT JOIN public.profiles pr ON pr.user_id = h.locked_by_user_id
    WHERE h.tournament_id = p_tournament_id AND h.status = 'in_progress'
  ) sub;

  RETURN jsonb_build_object('ok', true, 'locks', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tracker_table_locks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tracker_table_locks(uuid, uuid) TO authenticated, service_role;

-- 3. Self-verify (run manually in the apply session — illustrative, do NOT auto-run).
--    Like the other tracker RPCs, a raw SQL call runs where auth.uid() IS NULL → returns
--    {ok:false,error:'actor_not_allowed'}, itself proof the Step-0 guard is live.
-- SECURITY:
--   * anon / spoofed actor                              → actor_not_allowed
--   * tracker forcing a takeover (p_force=true)          → force_requires_floor
--   * takeover of a FRESH lock held by another (no force)→ lock_fresh {locked_by, age_seconds}
--   * grants: authenticated + service_role only
-- TWO-WRITER SAFETY (the whole point) — via app under two JWTs, one table:
--   * A holds the lock (fresh). B calls takeover_hand_lock(no force) → lock_fresh (refused).
--   * A goes idle > 5 min → B takeover → ok; A's next record_action → tracker_lock_blocks
--     refuses it (A must reload). At no instant do both consoles write.
