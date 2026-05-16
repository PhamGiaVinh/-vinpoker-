CREATE POLICY "Club owners can insert registrations for their tournaments"
ON public.stack_registrations
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.clubs c ON c.id = t.club_id
    WHERE t.id = stack_registrations.tournament_id
      AND c.owner_id = auth.uid()
  )
);