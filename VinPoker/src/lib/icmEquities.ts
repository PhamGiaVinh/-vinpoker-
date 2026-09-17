/** Standalone ICM reference calculator. Never used to settle a tournament payout. */
export function icmEquities(chips: number[], prizes: number[]): number[] {
  const n = chips.length;
  if (n < 2 || n > 15 || prizes.length !== n || Array.from(chips).some((x) => !Number.isFinite(x) || x <= 0)) {
    throw new RangeError("Invalid ICM stacks");
  }
  const totalChips = chips.reduce((sum, x) => sum + x, 0);
  const totalPrizes = prizes.reduce((sum, x) => sum + x, 0);
  if (!Number.isFinite(totalChips) || Array.from(prizes).some((x) => !Number.isFinite(x) || x < 0) || !Number.isFinite(totalPrizes) || totalPrizes <= 0) {
    throw new RangeError("Invalid ICM prizes");
  }

  // dp[mask] is the probability that precisely this set filled the first |mask| places.
  // Each subset is visited once; unlike enumerating all orders this is O(n * 2^n).
  const fullMask = (1 << n) - 1;
  const dp = new Float64Array(fullMask + 1);
  const places = new Uint8Array(fullMask + 1);
  const equities = Array<number>(n).fill(0);
  dp[0] = 1;
  for (let mask = 0; mask < fullMask; mask++) {
    if (mask) places[mask] = places[mask >> 1] + (mask & 1);
    if (dp[mask] === 0) continue;
    let remaining = 0;
    for (let player = 0; player < n; player++) {
      if ((mask & (1 << player)) === 0) remaining += chips[player];
    }
    for (let player = 0; player < n; player++) {
      if (mask & (1 << player)) continue;
      // Divide first: multiplying dp by a valid subnormal stack can underflow.
      const nextProbability = dp[mask] * (chips[player] / remaining);
      equities[player] += nextProbability * prizes[places[mask]];
      dp[mask | (1 << player)] += nextProbability;
    }
  }
  return equities;
}
