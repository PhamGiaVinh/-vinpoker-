DROP POLICY IF EXISTS "Player creates own deal" ON public.staking_deals;

CREATE POLICY "Player creates own deal"
ON public.staking_deals
FOR INSERT
WITH CHECK (
  auth.uid() = player_id
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.verification_status = 'verified'
  )
);