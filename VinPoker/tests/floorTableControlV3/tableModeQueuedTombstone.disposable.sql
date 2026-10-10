\set ON_ERROR_STOP on
-- Isolated DB only, after tableModeRequest.disposable.sql.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE public.tracker_voice_configs SET correction_state='correction_pending'
WHERE tournament_table_id='00000000-0000-0000-0000-000000000770';
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'outcome'='pending','fixture queues mode before deletion');
  UPDATE public.tournaments SET deleted_at=now() WHERE id=s.tournament_id;
  PERFORM public.floor_table_v3_assert((SELECT status='expired' AND resolved_at IS NOT NULL AND blockers ? 'tournament_not_open' FROM floor_private.table_mode_requests_v1 WHERE id=(result->>'request_id')::uuid),'tombstoning expires request with audit reason');
  UPDATE public.tracker_voice_configs SET correction_state='ready' WHERE tournament_table_id='00000000-0000-0000-0000-000000000770';
  PERFORM floor_private.resolve_table_mode_request_v1(s.id);
  PERFORM public.floor_table_v3_assert((SELECT control_mode=s.control_mode AND control_epoch=s.control_epoch AND revision=s.revision FROM public.table_sessions WHERE id=s.id),
    'queued request cannot apply after tournament deletion');
  PERFORM public.floor_table_v3_assert((SELECT sum(chip_count)=30000 FROM public.tournament_seats WHERE table_session_id=s.id AND is_active),'queued tombstone preserves chips');
END $$;
ROLLBACK;

-- Model a legacy tombstone created before the new lifecycle trigger existed.
-- Disabling this trigger is test fixture DDL only and rolls back below.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
ALTER TABLE public.tournaments DISABLE TRIGGER trg_mode_tournament_lifecycle_v1;
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; pending_id uuid; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_request_table_control_mode_v4('00000000-0000-0000-0000-000000000770',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'outcome'='pending','legacy fixture queues before tombstone');
  pending_id:=(result->>'request_id')::uuid;
  UPDATE public.tournaments SET deleted_at=now() WHERE id=s.tournament_id;
  PERFORM public.floor_table_v3_assert((SELECT status='pending' FROM floor_private.table_mode_requests_v1 WHERE id=pending_id),'legacy fixture bypasses only lifecycle trigger');
  result:=floor_private.resolve_table_mode_request_v1(s.id);
  PERFORM public.floor_table_v3_assert(result->>'outcome'='expired','resolver independently expires legacy tombstone');
  PERFORM public.floor_table_v3_assert((SELECT control_mode=s.control_mode AND control_epoch=s.control_epoch AND revision=s.revision FROM public.table_sessions WHERE id=s.id),'legacy resolver preserves session generation');
END $$;
ROLLBACK;
