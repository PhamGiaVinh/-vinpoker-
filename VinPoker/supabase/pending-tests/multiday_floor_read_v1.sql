-- Disposable PG17: owner-scoped Floor read contains only authoritative data.
DO $$ DECLARE v_out jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_out:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000000a');
 IF v_out->>'releaseEnabled'<>'true' OR
    v_out->'rules'->>'policy'<>'SUM_STACKS' OR
    v_out->'rules'->>'day2Percent' IS DISTINCT FROM v_out->'rules'->>'itmPercent' OR
    v_out->'qualification'->>'sourceHash' IS NULL OR
    v_out->'finalization'->>'payoutInputHash' IS NULL OR
    jsonb_array_length(v_out->'finalization'->'obligations')<1 OR
    jsonb_array_length(v_out->'finalization'->'sourceSnapshot'->'payments')<1 OR
    jsonb_array_length(v_out->'correctionRequests')<2 THEN
   RAISE EXCEPTION 'floor_projection_incomplete: %',v_out;
 END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000000a');
   RAISE EXCEPTION 'other_club_read_accepted';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_floor_owner_required' THEN RAISE; END IF;
 END;
END $$;
SELECT 'multiday_floor_read_v1 PASS' AS result;
