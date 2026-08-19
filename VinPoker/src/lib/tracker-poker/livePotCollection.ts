export type LivePotCollectionGateInput = {
  enabled: boolean;
  runout: boolean;
  finalAllIn: boolean;
  hasCommittedChips: boolean;
};

/**
 * Presentation-only gate for moving committed chips to the felt center.
 * It never infers a winner or a payout; those remain verified-settlement data.
 */
export function shouldCollectCommittedChips({
  enabled,
  runout,
  finalAllIn,
  hasCommittedChips,
}: LivePotCollectionGateInput): boolean {
  return enabled && hasCommittedChips && (runout || finalAllIn);
}
