// Staking math — must match supabase fn_compute_staking_payouts exactly.
// Formula A (StakeKings standard):
//   backer_share = round(prize * pct/100)   — markup is NOT in the split
//   fee          = 0                         — MVP, no platform fee
//   player_share = prize - backer_share - fee  (clamped >= 0)
// Markup affects only the initial escrow asking price, never the prize split.

export interface StakingPayouts {
  player: number;
  backer: number;
  fee: number;
}

export function computeAskingPrice(
  buyInVnd: number,
  percentageSold: number,
  markup: number
): number {
  return Math.round((buyInVnd * percentageSold) / 100 * markup);
}

// Vietnam MVP: fixed archive fee 199.000 ₫ per completed deal (paid by Player out of prize).
export const ARCHIVE_FEE_VND = 199000;

export function computeStakingPayouts(
  prizeVnd: number,
  percentageSold: number,
  _markup?: number, // unused; kept for backward-compat call sites
  _percentFee?: number, // FUTURE: international expansion. Not used in MVP.
  archiveFee: number = ARCHIVE_FEE_VND,
): StakingPayouts {
  if (!prizeVnd || prizeVnd <= 0) return { player: 0, backer: 0, fee: 0 };
  // ============================================
  // FUTURE: International expansion (preserve)
  //   const fee = Math.floor((prizeVnd * (_percentFee ?? 1.0)) / 100);
  // ============================================
  // NEW: fixed archive fee, capped at prize so we never go negative.
  const fee = Math.min(archiveFee, prizeVnd);
  const distributable = Math.max(0, prizeVnd - fee);
  const backer = Math.round((distributable * percentageSold) / 100);
  let player = distributable - backer;
  if (player < 0) player = 0;
  return { player, backer, fee };
}

// FUTURE: International expansion (preserve)
export const PLATFORM_FEE_RATE = 1.0;
