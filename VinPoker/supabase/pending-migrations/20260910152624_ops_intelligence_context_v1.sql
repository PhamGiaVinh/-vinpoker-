-- Wave 2: read-only inventory. Apply is separately owner-gated.
-- Rollback: DROP FUNCTION public.get_ops_intelligence_context_v1(uuid);
BEGIN;
CREATE OR REPLACE FUNCTION public.get_ops_intelligence_context_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL
    OR NOT COALESCE(public.is_club_owner(v_actor, p_club_id), false)
    OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id)
  THEN RAISE EXCEPTION 'OPS_CONTEXT_ACCESS_DENIED' USING ERRCODE = '42501'; END IF;

  WITH scoped_tournaments AS (
    SELECT t.id, t.event_id, t.start_time,
      jsonb_build_object(
        'tournamentId', t.id, 'name', t.name, 'status', t.status,
        'startTime', to_char(t.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'buyIn', t.buy_in, 'gtd', t.guarantee_amount,
        'phase', CASE WHEN t.event_id IS NULL THEN NULL ELSE t.phase END,
        'flightLabel', CASE WHEN t.event_id IS NULL THEN NULL ELSE t.flight_label END
      ) AS payload
    FROM public.tournaments t
    WHERE t.club_id = p_club_id AND t.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'version', 'ops-intelligence-context-v1', 'clubId', p_club_id,
    'asOf', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dailyTournaments', COALESCE((SELECT jsonb_agg(payload ORDER BY start_time NULLS LAST, id) FROM scoped_tournaments WHERE event_id IS NULL), '[]'::jsonb),
    'festivals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'festivalId', f.id, 'name', f.name, 'status', f.status,
      -- A malformed cross-club pointer is not exposed as another tenant's identity.
      'finalTournamentId', CASE WHEN EXISTS (SELECT 1 FROM scoped_tournaments t WHERE t.id = f.final_tournament_id) THEN f.final_tournament_id ELSE NULL END,
      'tournaments', COALESCE((SELECT jsonb_agg(payload ORDER BY start_time NULLS LAST, id) FROM scoped_tournaments WHERE event_id = f.id), '[]'::jsonb)
    ) ORDER BY f.id) FROM public.tournament_events f WHERE f.club_id = p_club_id), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_ops_intelligence_context_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ops_intelligence_context_v1(uuid) TO authenticated;
COMMIT;
