-- Run immediately after TV V3; verifies current multiblock writer and immutable publish revision.
UPDATE public.centerpoint_tournament_ops_release
SET enabled = false, allowed_club_ids = ARRAY['10000000-0000-4000-8000-000000000001']::uuid[]
WHERE id;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE v_message text;
BEGIN
  BEGIN
    PERFORM public.save_tv_tournament_layout_v1(
      '50000000-0000-4000-8000-000000000001', 1, 'Gate Test', NULL, NULL,
      '{"brand_x":50,"brand_y":10,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","text_blocks":[]}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'authorized V3 writer unexpectedly succeeded with gate OFF';
END;
$$;
RESET ROLE;

UPDATE public.centerpoint_tournament_ops_release
SET enabled = true, allowed_club_ids = ARRAY['10000000-0000-4000-8000-000000000001']::uuid[]
WHERE id;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', false);
DO $$
DECLARE v_message text;
BEGIN
  BEGIN
    PERFORM public.save_tv_tournament_layout_v1(
      '50000000-0000-4000-8000-000000000002', 0, 'Wrong Club', NULL, NULL,
      '{"brand_x":50,"brand_y":10,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","text_blocks":[]}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'V3 writer unexpectedly allowed an actor whose tournament club is not allowlisted';
END;
$$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', false);
DO $$
DECLARE v_message text;
BEGIN
  BEGIN
    PERFORM public.save_tv_tournament_layout_v1(
      '50000000-0000-4000-8000-000000000001', 1, 'Wrong Role', NULL, NULL,
      '{"brand_x":50,"brand_y":10,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","text_blocks":[]}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'tv_layout_forbidden' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'V3 writer unexpectedly allowed an unrelated authenticated actor';
END;
$$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.save_tv_tournament_layout_v1(
    '50000000-0000-4000-8000-000000000001', 1, 'Authorized Multiblock Event', NULL, NULL,
    '{"brand_x":50,"brand_y":10,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","text_blocks":[]}'::jsonb
  );
  IF v_result->>'scope_type' <> 'event'
     OR v_result->>'brand_name' <> 'Authorized Multiblock Event'
     OR (v_result->>'revision')::bigint <> 2 THEN
    RAISE EXCEPTION 'authorized V3 publish did not persist the expected Main Event revision';
  END IF;
END;
$$;
RESET ROLE;

-- Snapshot tables deliberately deny direct authenticated reads; verify durable
-- publication as the disposable database owner rather than weakening grants.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tv_tournament_layout_versions v
    JOIN public.tv_tournament_layouts l ON l.id = v.layout_id
    WHERE l.event_id = '40000000-0000-4000-8000-000000000001'
      AND v.revision = 2 AND v.brand_name = 'Authorized Multiblock Event'
      AND jsonb_typeof(v.layout->'text_blocks') = 'array'
  ) THEN
    RAISE EXCEPTION 'successful V3 publish did not create its immutable revision snapshot';
  END IF;
END;
$$;

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_tv_tournament_layout_v1(
      '50000000-0000-4000-8000-000000000001', 2, 'Anon', NULL, NULL,
      '{"brand_x":50,"brand_y":10,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","text_blocks":[]}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'anon unexpectedly has EXECUTE on the V3 writer';
END;
$$;
RESET ROLE;
