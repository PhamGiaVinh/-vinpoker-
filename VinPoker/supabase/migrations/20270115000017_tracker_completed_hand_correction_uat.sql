-- Tracker correction Release 3 UAT: exact-scope authorization for correcting
-- only the latest completed effective hand. No scope rows are seeded.
-- Rollback: disable/delete correct_completed_hand scope rows, revoke this RPC,
-- and revoke commit_tracker_hand_correction_outcome from service_role.
BEGIN;

ALTER TABLE public.tracker_correction_uat_scopes
  DROP CONSTRAINT IF EXISTS tracker_correction_uat_scopes_capability_check;
ALTER TABLE public.tracker_correction_uat_scopes
  ADD CONSTRAINT tracker_correction_uat_scopes_capability_check
  CHECK (capability IN ('report_wrong_action', 'undo_open_hand', 'correct_completed_hand'));

CREATE OR REPLACE FUNCTION public.authorize_tracker_completed_hand_correction_uat_v1(
  p_tournament_id uuid,
  p_hand_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hand record;
BEGIN
  IF v_actor IS NULL OR p_tournament_id IS NULL OR p_hand_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT h.id, h.tournament_id, h.tournament_table_id, h.created_at,
         h.status, h.is_voided, h.source_revision, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id AND h.tournament_id = p_tournament_id;
  IF NOT FOUND OR v_hand.status <> 'completed' OR COALESCE(v_hand.is_voided, false)
     OR v_hand.tournament_table_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_target_hand');
  END IF;
  IF NOT (public.is_club_owner(v_actor, v_hand.club_id)
    OR public.is_club_admin(v_actor, v_hand.club_id)) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tracker_correction_uat_scopes scope_row
    WHERE scope_row.club_id = v_hand.club_id
      AND scope_row.tournament_id = p_tournament_id
      AND scope_row.tournament_table_id = v_hand.tournament_table_id
      AND scope_row.user_id = v_actor
      AND scope_row.capability = 'correct_completed_hand'
      AND scope_row.enabled IS TRUE
      AND (scope_row.expires_at IS NULL OR scope_row.expires_at > pg_catalog.now())
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'uat_capability_disabled');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands active_hand
    WHERE active_hand.tournament_id = p_tournament_id
      AND active_hand.status = 'in_progress'
      AND NOT COALESCE(active_hand.is_voided, false)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'active_hand_blocks_resettle');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_hands later_hand
    WHERE later_hand.tournament_id = p_tournament_id
      AND NOT COALESCE(later_hand.is_voided, false)
      AND later_hand.status = 'completed'
      AND (later_hand.created_at, later_hand.id) > (v_hand.created_at, v_hand.id)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'later_hand_scope_not_supported');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'tournament_table_id', v_hand.tournament_table_id,
    'source_revision', v_hand.source_revision, 'scope', 'latest_completed_hand_only'
  );
END;
$$;

ALTER FUNCTION public.authorize_tracker_completed_hand_correction_uat_v1(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authorize_tracker_completed_hand_correction_uat_v1(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_tracker_completed_hand_correction_uat_v1(uuid, uuid)
  TO authenticated;

DO $grant_writer$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'tracker_hand_correction_commit_dependency_missing';
  END IF;
  GRANT EXECUTE ON FUNCTION public.commit_tracker_hand_correction_outcome(
    uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text
  ) TO service_role;
END;
$grant_writer$;

COMMIT;
