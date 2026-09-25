-- Shared Centerpoint tournament-ops release gate, base layer only.
-- PENDING SOURCE ONLY. This migration intentionally does not attach consumer
-- triggers or alter TV/Satellite RPCs: their tables/functions are introduced by
-- separate open pending-migration chains and are not present in origin/main.
-- Any consumer integration must run after its dependency migrations and must
-- call centerpoint_private.assert_tournament_ops_release_v1(club_id) at the
-- server-side write boundary, while retaining that consumer's actor/club checks.
--
-- ROLLBACK: only before any consumer depends on this gate; use a reviewed,
-- owner-gated forward migration to revoke helpers and remove the singleton.

BEGIN;

CREATE TABLE IF NOT EXISTS public.centerpoint_tournament_ops_release (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  allowed_club_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO public.centerpoint_tournament_ops_release (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.centerpoint_tournament_ops_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.centerpoint_tournament_ops_release
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.centerpoint_tournament_ops_release
  TO service_role;

CREATE SCHEMA IF NOT EXISTS centerpoint_private;
REVOKE ALL ON SCHEMA centerpoint_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA centerpoint_private TO service_role;

CREATE OR REPLACE FUNCTION centerpoint_private.tournament_ops_release_allowed_v1(
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT r.enabled
       AND p_club_id IS NOT NULL
       AND p_club_id = ANY(r.allowed_club_ids)
    FROM public.centerpoint_tournament_ops_release AS r
    WHERE r.id
  ), false);
$$;

REVOKE ALL ON FUNCTION centerpoint_private.tournament_ops_release_allowed_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION centerpoint_private.tournament_ops_release_allowed_v1(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION centerpoint_private.assert_tournament_ops_release_v1(
  p_club_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(
    centerpoint_private.tournament_ops_release_allowed_v1(p_club_id), false
  ) THEN
    RAISE EXCEPTION 'CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION centerpoint_private.assert_tournament_ops_release_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION centerpoint_private.assert_tournament_ops_release_v1(uuid)
  TO service_role;

COMMIT;
