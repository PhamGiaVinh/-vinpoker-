// Series Intelligence — useGroupingOverrides hook (PATCH 2.5).
//
// Holds the manual grouping overrides in React state, hydrates from localStorage, persists on change,
// and prunes orphan labels whenever the loaded library changes. Pure logic lives in
// groupingOverrides.ts; this just wires it to React + storage. Client-only — no server calls.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Series } from "./seriesLibrary";
import { obsKeyOf } from "./referenceDistribution";
import {
  clearOverrides,
  loadOverrides,
  makeManualLabel,
  mergeUnderLabel,
  pruneOverrides,
  resetKeys,
  saveOverrides,
  type GroupingOverrides,
} from "./groupingOverrides";

export interface UseGroupingOverrides {
  overrideLabels: Record<string, string>;
  hasOverrides: boolean;
  merge: (obsKeys: string[]) => void; // assign a shared new label → merges them (and splits from old group)
  reset: (obsKeys: string[]) => void; // revert these to auto grouping
  resetAll: () => void;
}

export function useGroupingOverrides(series: Series[]): UseGroupingOverrides {
  const [overrides, setOverrides] = useState<GroupingOverrides>(() => loadOverrides());

  useEffect(() => {
    saveOverrides(overrides);
  }, [overrides]);

  // The obsKeys that currently exist in the loaded library (for orphan pruning).
  const validKeys = useMemo(
    () => new Set(series.flatMap((s) => s.events.map((e) => obsKeyOf(s.id, e.event_id)))),
    [series],
  );
  useEffect(() => {
    // pruneOverrides returns the SAME reference when nothing is orphaned → no extra render/save.
    setOverrides((prev) => pruneOverrides(prev, validKeys));
  }, [validKeys]);

  const merge = useCallback((obsKeys: string[]) => {
    setOverrides((prev) => mergeUnderLabel(prev, obsKeys, makeManualLabel(obsKeys)));
  }, []);
  const reset = useCallback((obsKeys: string[]) => setOverrides((prev) => resetKeys(prev, obsKeys)), []);
  const resetAll = useCallback(() => setOverrides(clearOverrides()), []);

  return {
    overrideLabels: overrides.labels,
    hasOverrides: Object.keys(overrides.labels).length > 0,
    merge,
    reset,
    resetAll,
  };
}
