export function getTournamentPrice(t: {
  buy_in: number;
  rake_amount?: number | null;
  free_rake_enabled?: boolean | null;
  free_rake_slots?: number | null;
  free_rake_used?: number | null;
}) {
  const rake = t.rake_amount ?? 0;
  const enabled = !!t.free_rake_enabled;
  const slots = t.free_rake_slots ?? 0;
  const used = t.free_rake_used ?? 0;
  const remaining = Math.max(0, slots - used);
  const hasDiscount = enabled && remaining > 0;
  const originalPrice = t.buy_in + rake;
  return {
    displayPrice: hasDiscount ? t.buy_in : originalPrice,
    originalPrice,
    hasDiscount,
    promotionEnabled: enabled,
    remainingSlots: remaining,
    savings: rake,
  };
}
