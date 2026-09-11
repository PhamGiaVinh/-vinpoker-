const MAX_DECIMALS = 2;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Spectator-only chip-to-BB formatter. The raw chip amount remains the source of
 * truth; rounding happens only on the final display string.
 */
export function formatViewerBB(amount: number, bigBlind: number): string | null {
  if (!Number.isFinite(amount) || amount < 0 || !finitePositive(bigBlind)) return null;
  const rounded = Math.round((amount / bigBlind + Number.EPSILON) * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS;
  const text = rounded.toFixed(MAX_DECIMALS).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return `${text} BB`;
}

export function formatViewerBBOrUnavailable(amount: number, bigBlind: number): string {
  return formatViewerBB(amount, bigBlind) ?? "— BB";
}

export interface BlindActionLike {
  player_id: string;
  action_type: string;
  action_amount: number | null | undefined;
}

/**
 * Resolve a hand's BB without treating a stack-consuming blind post as proof of
 * the level. An explicit hand snapshot always wins; otherwise a normal post_bb
 * is accepted. Returning 0 makes the viewer fail closed with “— BB”.
 */
export function resolveViewerHandBigBlind({
  explicitBigBlind,
  actions,
  startingStacks,
}: {
  explicitBigBlind?: number | null;
  actions: readonly BlindActionLike[];
  startingStacks?: ReadonlyMap<string, number>;
}): number {
  if (finitePositive(explicitBigBlind)) return Math.floor(explicitBigBlind);

  const candidates = actions
    .filter((action) => action.action_type === "post_bb" && finitePositive(action.action_amount))
    .map((action) => {
      const amount = Math.floor(action.action_amount as number);
      const startingStack = startingStacks?.get(action.player_id);
      const stackConsumed = finitePositive(startingStack) && startingStack <= amount;
      return stackConsumed ? 0 : amount;
    })
    .filter((amount) => amount > 0);

  return candidates.length > 0 ? Math.max(...candidates) : 0;
}
