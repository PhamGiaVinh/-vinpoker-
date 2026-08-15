export type BuyinReceiptAccessInput = {
  callerId: string;
  playerId: string;
  staffAuthorized: boolean;
};

/** Pure BOLA/IDOR guard shared by the Edge handler and its actor-matrix test. */
export function canReadBuyinReceipt(
  { callerId, playerId, staffAuthorized }: BuyinReceiptAccessInput,
): boolean {
  return callerId === playerId || staffAuthorized;
}
