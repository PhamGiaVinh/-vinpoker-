import { useMemo } from "react";

function semanticScopeKey(...groups: readonly (readonly string[])[]) {
  return JSON.stringify(Array.from(new Set(groups.flat())).sort());
}

/**
 * Keeps the Floor club-scope array referentially stable while its membership is
 * unchanged. Consumers may safely depend on the returned array without
 * refetching after unrelated auth/display state updates.
 */
export function useStableFloorClubIds(
  operatorClubIds: readonly string[],
  dealerClubIds: readonly string[],
) {
  const scopeKey = semanticScopeKey(operatorClubIds, dealerClubIds);
  return useMemo(() => JSON.parse(scopeKey) as string[], [scopeKey]);
}
