-- Allows a current club owner to attach an external stream without first
-- creating a tournament. A custom stream remains scoped to its server-owned
-- creator; another club owner cannot update or delete it. Super-admin keeps
-- its existing administrative access.
--
-- Depends on 20270110000009_tournament_streams_owner_write_policy.sql, which
-- makes created_by server-owned and immutable. The creator predicate below is
-- therefore evaluated after the trigger has assigned auth.uid() on INSERT.
--
-- ROLLBACK: drop the three policies below and re-apply the verified policies
-- from 20270110000009_tournament_streams_owner_write_policy.sql. This
-- migration changes no rows, grants, functions, triggers, or public read
-- policy.

DROP POLICY IF EXISTS "Tournament stream managers insert" ON public.tournament_streams;
DROP POLICY IF EXISTS "Tournament stream managers update" ON public.tournament_streams;
DROP POLICY IF EXISTS "Tournament stream managers delete" ON public.tournament_streams;

CREATE POLICY "Tournament stream managers insert"
  ON public.tournament_streams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select public.has_role((select auth.uid()), 'super_admin'::public.app_role))
    OR (
      tournament_streams.tournament_id IS NULL
      AND tournament_streams.created_by = (select auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.clubs AS owner_club
        WHERE owner_club.owner_id = (select auth.uid())
      )
    )
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
    OR (
      tournament_streams.tournament_id IS NULL
      AND tournament_streams.created_by = (select auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.clubs AS owner_club
        WHERE owner_club.owner_id = (select auth.uid())
      )
    )
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
    OR (
      tournament_streams.tournament_id IS NULL
      AND tournament_streams.created_by = (select auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.clubs AS owner_club
        WHERE owner_club.owner_id = (select auth.uid())
      )
    )
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
    OR (
      tournament_streams.tournament_id IS NULL
      AND tournament_streams.created_by = (select auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.clubs AS owner_club
        WHERE owner_club.owner_id = (select auth.uid())
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.tournaments AS tournament
      JOIN public.clubs AS club ON club.id = tournament.club_id
      WHERE tournament.id = tournament_streams.tournament_id
        AND club.owner_id = (select auth.uid())
    )
  );
