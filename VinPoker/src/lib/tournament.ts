export function getTournamentPrice(t: {
  buy_in: number;
  rake_amount?: number | null;
  service_fee_amount?: number | null;
  free_rake_enabled?: boolean | null;
  free_rake_slots?: number | null;
  free_rake_used?: number | null;
}) {
  const rake = t.rake_amount ?? 0;
  // Service fee (phí dịch vụ) is a SECOND charge, separate from rake. Free-rake waives the RAKE
  // only — the service fee is always part of the price. Defaults to 0 (and is 0 for any tour whose
  // object/column predates the feature), so existing tours are unaffected.
  const service = t.service_fee_amount ?? 0;
  const enabled = !!t.free_rake_enabled;
  const slots = t.free_rake_slots ?? 0;
  const used = t.free_rake_used ?? 0;
  const remaining = Math.max(0, slots - used);
  const hasDiscount = enabled && remaining > 0;
  const originalPrice = t.buy_in + rake + service;
  return {
    displayPrice: hasDiscount ? t.buy_in + service : originalPrice, // free-rake waives rake only
    originalPrice,
    hasDiscount,
    promotionEnabled: enabled,
    remainingSlots: remaining,
    savings: rake,
  };
}
