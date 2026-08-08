\set ON_ERROR_STOP on

-- Run only in a dedicated disposable database. This reproduces the live drift:
-- a PL/pgSQL function exists before the columns it references.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE public.hand_players (
  id uuid PRIMARY KEY,
  marker text NOT NULL
);

CREATE TABLE public.hand_start_markers (
  id uuid PRIMARY KEY
);

INSERT INTO public.hand_players (id, marker)
VALUES ('10000000-0000-0000-0000-000000000001', 'existing-row');

CREATE OR REPLACE FUNCTION public.probe_start_hand_identity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.hand_start_markers (id)
  VALUES ('20000000-0000-0000-0000-000000000001');

  INSERT INTO public.hand_players (id, marker, player_name, avatar_url)
  VALUES (
    '10000000-0000-0000-0000-000000000002',
    'new-hand-player',
    'Snapshot Name',
    'https://example.invalid/avatar.png'
  );
END;
$$;

ALTER FUNCTION public.probe_start_hand_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.probe_start_hand_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.probe_start_hand_identity() TO authenticated;

CREATE TEMP TABLE function_before AS
SELECT
  pg_get_functiondef(p.oid) AS definition,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.proacl,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
WHERE p.oid = 'public.probe_start_hand_identity()'::regprocedure;

DO $$
BEGIN
  BEGIN
    PERFORM public.probe_start_hand_identity();
    RAISE EXCEPTION 'pre-migration probe unexpectedly succeeded';
  EXCEPTION
    WHEN undefined_column THEN
      RAISE NOTICE 'PRE_MIGRATION_UNDEFINED_COLUMN_REPRODUCED';
  END;

  IF (SELECT count(*) FROM public.hand_players) <> 1
     OR (SELECT count(*) FROM public.hand_start_markers) <> 0 THEN
    RAISE EXCEPTION 'failed pre-migration call left a partial hand or player row';
  END IF;
END;
$$;

\ir ../../supabase/migrations/20270110000002_hand_players_identity_columns_forward_fix.sql

DO $$
DECLARE
  v_before function_before%ROWTYPE;
  v_after RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hand_players'
      AND column_name = 'player_name'
      AND is_nullable = 'YES'
      AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hand_players'
      AND column_name = 'avatar_url'
      AND is_nullable = 'YES'
      AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'identity columns were not added with the expected shape';
  END IF;

  IF (SELECT marker FROM public.hand_players WHERE id = '10000000-0000-0000-0000-000000000001')
      IS DISTINCT FROM 'existing-row'
     OR (SELECT player_name FROM public.hand_players WHERE id = '10000000-0000-0000-0000-000000000001')
      IS NOT NULL
     OR (SELECT avatar_url FROM public.hand_players WHERE id = '10000000-0000-0000-0000-000000000001')
      IS NOT NULL THEN
    RAISE EXCEPTION 'existing row changed during additive repair';
  END IF;

  SELECT * INTO v_before FROM function_before;
  SELECT
    pg_get_functiondef(p.oid) AS definition,
    pg_get_userbyid(p.proowner) AS owner_name,
    p.proacl,
    p.prosecdef,
    p.proconfig
  INTO v_after
  FROM pg_proc p
  WHERE p.oid = 'public.probe_start_hand_identity()'::regprocedure;

  IF v_before.definition IS DISTINCT FROM v_after.definition
     OR v_before.owner_name IS DISTINCT FROM v_after.owner_name
     OR v_before.proacl IS DISTINCT FROM v_after.proacl
     OR v_before.prosecdef IS DISTINCT FROM v_after.prosecdef
     OR v_before.proconfig IS DISTINCT FROM v_after.proconfig THEN
    RAISE EXCEPTION 'function security metadata changed during column repair';
  END IF;
END;
$$;

SELECT public.probe_start_hand_identity();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.hand_players) <> 2
     OR (SELECT count(*) FROM public.hand_start_markers) <> 1
     OR (SELECT player_name FROM public.hand_players WHERE id = '10000000-0000-0000-0000-000000000002')
        IS DISTINCT FROM 'Snapshot Name'
     OR (SELECT avatar_url FROM public.hand_players WHERE id = '10000000-0000-0000-0000-000000000002')
        IS DISTINCT FROM 'https://example.invalid/avatar.png' THEN
    RAISE EXCEPTION 'post-migration function call did not persist identity snapshot';
  END IF;
  RAISE NOTICE 'POST_MIGRATION_FUNCTION_RUNTIME_PASS';
END;
$$;

-- The exact migration must be safe to retry on an already-repaired schema.
\ir ../../supabase/migrations/20270110000002_hand_players_identity_columns_forward_fix.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.hand_players) <> 2
     OR (SELECT count(*) FROM public.hand_start_markers) <> 1 THEN
    RAISE EXCEPTION 'idempotent migration retry changed row count';
  END IF;
  RAISE NOTICE 'HAND_PLAYER_IDENTITY_FORWARD_REPAIR_PASS';
END;
$$;
