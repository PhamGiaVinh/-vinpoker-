import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allHands,
  emptyHandAction,
  normalizeHandAction,
  updateHandAction,
  type HandAction,
  type Range,
} from "@/lib/gto/rangeTree";
import {
  exportRangeSnippet,
  getPrecomputedRange,
  saveCustomRange,
  clearCustomRange,
  subscribeRangeUpdates,
  type SpotKey,
} from "@/lib/gto/precomputed";

/**
 * Hook giúp super admin chỉnh tay 169 hand cho 1 spotKey.
 * - Range nguồn: DB (gto_spot_ranges) > hard-coded > tất cả fold
 * - save() upsert lên DB (RLS chỉ cho super_admin) → broadcast realtime cho tất cả user
 * - reset() xóa row trong DB (revert về hard-coded)
 */
export function useRangeEditor(spotKey: SpotKey) {
  const [range, setRange] = useState<Range>(() => initialRange(spotKey));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload khi đổi spotKey hoặc khi remote DB cập nhật (và user chưa có chỉnh sửa local chưa save)
  useEffect(() => {
    setRange(initialRange(spotKey));
    setDirty(false);
  }, [spotKey]);

  useEffect(() => {
    return subscribeRangeUpdates(() => {
      if (!dirty) {
        setRange(initialRange(spotKey));
      }
    });
  }, [spotKey, dirty]);

  const setHandAction = useCallback((hand: string, ha: HandAction) => {
    setRange((prev) => ({ ...prev, [hand]: normalizeHandAction(ha) }));
    setDirty(true);
  }, []);

  const replaceRange = useCallback((next: Range) => {
    const merged: Range = {};
    for (const h of allHands()) {
      merged[h] = next[h] ? normalizeHandAction(next[h]) : emptyHandAction();
    }
    setRange(merged);
    setDirty(true);
  }, []);

  const setHandFreq = useCallback(
    (hand: string, key: keyof HandAction, freq: number) => {
      setRange((prev) => updateHandAction(prev, hand, key, freq));
      setDirty(true);
    },
    [],
  );

  const setAllFold = useCallback(() => {
    const next: Range = {};
    for (const h of allHands()) next[h] = emptyHandAction();
    setRange(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await saveCustomRange(spotKey, range);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [spotKey, range]);

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      await clearCustomRange(spotKey);
      setRange(initialRange(spotKey));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [spotKey]);

  const exportSnippet = useCallback(
    () => exportRangeSnippet(spotKey, range),
    [spotKey, range],
  );

  const stats = useMemo(() => computeStats(range), [range]);

  return {
    range,
    dirty,
    saving,
    stats,
    setHandAction,
    setHandFreq,
    setAllFold,
    replaceRange,
    save,
    reset,
    exportSnippet,
  };
}

function initialRange(spotKey: SpotKey): Range {
  const existing = getPrecomputedRange(spotKey);
  if (existing) return existing;
  const r: Range = {};
  for (const h of allHands()) r[h] = emptyHandAction();
  return r;
}

function computeStats(range: Range) {
  let fold = 0, call = 0, raise = 0, allin = 0, n = 0;
  for (const h of Object.keys(range)) {
    const ha = range[h];
    fold += ha.fold;
    call += ha.call;
    raise += ha.raise;
    allin += ha.allin;
    n++;
  }
  if (n === 0) return { foldPct: 0, callPct: 0, raisePct: 0, allinPct: 0 };
  return {
    foldPct: (fold / n) * 100,
    callPct: (call / n) * 100,
    raisePct: (raise / n) * 100,
    allinPct: (allin / n) * 100,
  };
}
