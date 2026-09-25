-- Apply gate -> TV V1 -> V2 -> V3 before this file. All writes target disposable PG.
UPDATE public.centerpoint_tournament_ops_release
SET enabled = false, allowed_club_ids = ARRAY['10000000-0000-4000-8000-000000000001']::uuid[]
WHERE id;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id, name) VALUES
      ('backing-proofs', '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000001.png');
    RAISE EXCEPTION 'TV upload unexpectedly passed while release gate OFF';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

UPDATE public.centerpoint_tournament_ops_release
SET enabled = true, allowed_club_ids = ARRAY['10000000-0000-4000-8000-000000000001']::uuid[]
WHERE id;

DO $$
BEGIN
  IF NOT centerpoint_private.tournament_ops_release_allowed_v1('10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'fixture release gate did not enable the allowlisted club';
  END IF;
  IF NOT public.is_club_dealer_control(
    '20000000-0000-0000-0000-000000000001', '10000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'fixture actor is not a dealer controller for the allowlisted club';
  END IF;
END;
$$;

-- Temporary disposable-only diagnostic: expose gate components to the
-- authenticated test query without granting direct access to the release helper.
CREATE FUNCTION private.tv_storage_gate_diagnostic_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'enabled', r.enabled,
    'club_allowlisted', p_club_id = ANY(r.allowed_club_ids),
    'gate_allowed', centerpoint_private.tournament_ops_release_allowed_v1(p_club_id)
  )
  FROM public.centerpoint_tournament_ops_release r WHERE r.id
$$;
GRANT EXECUTE ON FUNCTION private.tv_storage_gate_diagnostic_v1(uuid) TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  -- Allowlisted actor cannot upload into another user's path.
  BEGIN
    INSERT INTO storage.objects(bucket_id, name) VALUES
      ('backing-proofs', '20000000-0000-0000-0000-000000000002/tv/branding-logo/v1/30000000-0000-0000-0000-000000000002.png');
    RAISE EXCEPTION 'wrong-UID TV upload unexpectedly passed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
DO $$
BEGIN
  -- Correct path UID without allowlisted club authority is still denied.
  BEGIN
    INSERT INTO storage.objects(bucket_id, name) VALUES
      ('backing-proofs', '20000000-0000-0000-0000-000000000002/tv/branding-background/v1/30000000-0000-0000-0000-000000000003.jpg');
    RAISE EXCEPTION 'non-allowlisted actor TV upload unexpectedly passed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
SELECT auth.uid() AS diagnostic_actor,
  (storage.foldername('20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png'))[1] AS diagnostic_path_uid,
  public.is_club_dealer_control(auth.uid(), '10000000-0000-4000-8000-000000000001') AS diagnostic_is_controller,
  private.tv_storage_gate_diagnostic_v1('10000000-0000-4000-8000-000000000001') AS diagnostic_gate,
  centerpoint_private.tv_branding_storage_insert_allowed_v1('backing-proofs', '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png') AS diagnostic_insert_allowed;

-- Authorized controller may create their own versioned asset.
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('backing-proofs', '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png');
-- TV restrictive policies do not affect ordinary backing-proof or other bucket uploads.
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('backing-proofs', '20000000-0000-0000-0000-000000000001/ordinary-proof.png'),
  ('avatars', '20000000-0000-0000-0000-000000000001/avatar.png');
DO $$
DECLARE
  v_rows bigint;
BEGIN
  -- RLS USING may silently filter rows, so assert zero affected and preservation.
  UPDATE storage.objects SET name = '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000005.png'
  WHERE bucket_id = 'backing-proofs' AND name = '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'versioned TV asset UPDATE affected % rows', v_rows; END IF;
  DELETE FROM storage.objects
  WHERE bucket_id = 'backing-proofs' AND name = '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'versioned TV asset DELETE affected % rows', v_rows; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'backing-proofs'
    AND name = '20000000-0000-0000-0000-000000000001/tv/branding-logo/v1/30000000-0000-0000-0000-000000000004.png') THEN
    RAISE EXCEPTION 'versioned TV asset was not preserved';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF to_regclass('public.tv_tournament_layouts') IS NULL
    OR to_regclass('public.tv_tournament_layout_versions') IS NULL
    OR to_regprocedure('public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb)') IS NULL
    OR to_regprocedure('centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)') IS NULL
    OR to_regprocedure('private.is_tv_branding_asset_immutable_v1(text,text)') IS NULL THEN
    RAISE EXCEPTION 'one or more gate/V1/V2/V3 objects are missing';
  END IF;
END;
$$;
