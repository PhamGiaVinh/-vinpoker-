-- Run immediately after TV V1 and before V2 revokes the per-club writer.
-- All mutations target the disposable PostgreSQL 17 service.
UPDATE public.centerpoint_tournament_ops_release
SET enabled = false, allowed_club_ids = ARRAY['10000000-0000-4000-8000-000000000001']::uuid[]
WHERE id;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM public.save_tv_branding_layout_v1(
      '10000000-0000-4000-8000-000000000001', 'Gate Test', NULL, NULL,
      '{"brand_x":50,"brand_y":45,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","custom_text":"V1"}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'authorized V1 writer unexpectedly succeeded with gate OFF';
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
    PERFORM public.save_tv_branding_layout_v1(
      '10000000-0000-4000-8000-000000000002', 'Wrong Club', NULL, NULL,
      '{"brand_x":50,"brand_y":45,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","custom_text":"V1"}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'V1 writer unexpectedly allowed an authorized actor from a non-allowlisted club';
END;
$$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', false);
DO $$
DECLARE v_message text;
BEGIN
  BEGIN
    PERFORM public.save_tv_branding_layout_v1(
      '10000000-0000-4000-8000-000000000001', 'Wrong Role', NULL, NULL,
      '{"brand_x":50,"brand_y":45,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","custom_text":"V1"}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message = 'tv_branding_forbidden' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'V1 writer unexpectedly allowed an unrelated authenticated actor';
END;
$$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.save_tv_branding_layout_v1(
    '10000000-0000-4000-8000-000000000001', 'Authorized V1', NULL, NULL,
    '{"brand_x":50,"brand_y":45,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","custom_text":"V1"}'::jsonb
  );
  IF v_result->>'brand_name' <> 'Authorized V1' THEN
    RAISE EXCEPTION 'authorized V1 write did not persist expected branding';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_tv_branding_layout_v1(
      '10000000-0000-4000-8000-000000000001', 'Anon', NULL, NULL,
      '{"brand_x":50,"brand_y":45,"brand_scale":100,"logo_scale":80,"background_x":50,"background_y":50,"font":"sans","custom_text":"V1"}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'anon unexpectedly has EXECUTE on the V1 writer';
END;
$$;
RESET ROLE;
