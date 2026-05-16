-- Helper: kiểm tra user có phải owner của CLB gắn với deal không (security definer để tránh recursion)
CREATE OR REPLACE FUNCTION public.is_deal_club_owner(_user_id uuid, _deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staking_deals d
    JOIN public.clubs c ON c.id = d.club_id
    WHERE d.id = _deal_id
      AND c.owner_id = _user_id
  )
$$;

-- Cashier (chính là owner CLB) được xem purchases của deal thuộc CLB của họ
CREATE POLICY "Cashier reads purchases of own club deals"
ON public.staking_purchases
FOR SELECT
USING (
  has_role(auth.uid(), 'cashier'::app_role)
  AND public.is_deal_club_owner(auth.uid(), deal_id)
);

-- Cashier xem deal của CLB họ (để JOIN load thông tin)
CREATE POLICY "Cashier reads own club deals"
ON public.staking_deals
FOR SELECT
USING (
  has_role(auth.uid(), 'cashier'::app_role)
  AND club_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = staking_deals.club_id AND c.owner_id = auth.uid())
);

-- Cashier xem escrow_transactions của deal CLB họ
CREATE POLICY "Cashier reads escrow tx of own club deals"
ON public.escrow_transactions
FOR SELECT
USING (
  has_role(auth.uid(), 'cashier'::app_role)
  AND public.is_deal_club_owner(auth.uid(), deal_id)
);

-- Cashier xem proof upload của deal CLB họ
CREATE POLICY "Cashier reads proofs of own club deals"
ON public.escrow_funding_proofs
FOR SELECT
USING (
  has_role(auth.uid(), 'cashier'::app_role)
  AND public.is_deal_club_owner(auth.uid(), deal_id)
);