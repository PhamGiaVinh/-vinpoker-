export interface HandHistoryLoadGuard {
  begin(): number;
  isCurrent(request: number): boolean;
  invalidate(): void;
}

/** Keeps a late hand-history response from replacing a newer table selection. */
export function createHandHistoryLoadGuard(): HandHistoryLoadGuard {
  let generation = 0;

  return {
    begin: () => ++generation,
    isCurrent: (request) => request === generation,
    invalidate: () => {
      generation += 1;
    },
  };
}
