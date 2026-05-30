CREATE OR REPLACE FUNCTION public.get_deal_purchase_breakdown(_deal_ids uuid[])
RETURNS TABLE (
  deal_id uuid,
  funded_pct integer,
  pending_pct integer,
  funded_count integer,
  pending_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.deal_id,
    COALESCE(SUM(p.percent) FILTER (WHERE p.status = 'funded'), 0)::int AS funded_pct,
    COALESCE(SUM(p.percent) FILTER (WHERE p.status = 'committed'), 0)::int AS pending_pct,
    COUNT(*) FILTER (WHERE p.status = 'funded')::int AS funded_count,
    COUNT(*) FILTER (WHERE p.status = 'committed')::int AS pending_count
  FROM public.staking_purchases p
  JOIN public.staking_deals d ON d.id = p.deal_id
  WHERE p.deal_id = ANY(_deal_ids)
    AND d.admin_review_status = 'approved'
    AND d.status IN ('listing'::staking_deal_status, 'committing'::staking_deal_status)
    AND d.early_closed = false
  GROUP BY p.deal_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_deal_purchase_breakdown(uuid[]) TO anon, authenticated;