-- Restores the missing authenticated write policies for tournament streams.
--
-- A stream is public to view, but a write is allowed only for a super-admin
-- or for the owner of the club that owns the linked tournament. Custom
-- streams (without tournament_id) remain super-admin-only.
--
-- created_by is server-owned: authenticated clients cannot choose another
-- actor on INSERT and cannot change the original actor on UPDATE.
--
-- ROLLBACK: drop trg_tournament_streams_creator_guard and
-- public.enforce_tournament_stream_creator(), then drop the three policies
-- below and restore the prior policy set from a verified live policy snapshot.
-- This migration does not change rows, table grants, or the public read policy.

CREATE OR REPLACE FUNCTION public.enforce_tournament_stream_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'tournament stream creator is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_streams_creator_guard ON public.tournament_streams;

CREATE TRIGGER trg_tournament_streams_creator_guard
  BEFORE INSERT OR UPDATE ON public.tournament_streams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tournament_stream_creator();

DROP POLICY IF EXISTS "Admin or club owner manage streams" ON public.tournament_streams;
DROP POLICY IF EXISTS "Tournament stream managers insert" ON public.tournament_streams;
DROP POLICY IF EXISTS "Tournament stream managers update" ON public.tournament_streams;
DROP POLICY IF EXISTS "Tournament stream managers delete" ON public.tournament_streams;

CREATE POLICY "Tournament stream managers insert"
  ON public.tournament_streams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select public.has_role((select auth.uid()), 'super_admin'::public.app_role))
    OR EXISTS (
      SELECT 1
      FROM public.tournaments AS tournament
      JOIN public.clubs AS club ON club.id = tournament.club_id
      WHERE tournament.id = tournament_streams.tournament_id
        AND club.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Tournament stream managers update"
  ON public.tournament_streams
  FOR UPDATE
  TO authenticated
  USING (
    (select public.has_role((select auth.uid()), 'super_admin'::public.app_role))
    OR EXISTS (
      SELECT 1
      FROM public.tournaments AS tournament
      JOIN public.clubs AS club ON club.id = tournament.club_id
      WHERE tournament.id = tournament_streams.tournament_id
        AND club.owner_id = (select auth.uid())
    )
  )
  WITH CHECK (
    (select public.has_role((select auth.uid()), 'super_admin'::public.app_role))
    OR EXISTS (
      SELECT 1
      FROM public.tournaments AS tournament
      JOIN public.clubs AS club ON club.id = tournament.club_id
      WHERE tournament.id = tournament_streams.tournament_id
        AND club.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Tournament stream managers delete"
  ON public.tournament_streams
  FOR DELETE
  TO authenticated
  USING (
    (select public.has_role((select auth.uid()), 'super_admin'::public.app_role))
    OR EXISTS (
      SELECT 1
      FROM public.tournaments AS tournament
      JOIN public.clubs AS club ON club.id = tournament.club_id
      WHERE tournament.id = tournament_streams.tournament_id
        AND club.owner_id = (select auth.uid())
    )
  );
