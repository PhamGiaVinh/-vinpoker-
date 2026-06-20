// Series Intelligence — useSeriesLibrary hook.
//
// Holds the Series Library in React state, hydrates it from localStorage on mount, and persists it
// on every change (with the size guard → `lastSaveError`). Pure logic lives in `seriesLibrary.ts`;
// this hook just wires it to React + storage. Client-only — no server calls.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SeriesEvent } from "./nativeData";
import {
  addSeries,
  emptyLibrary,
  loadLibrary,
  makeSeriesFromParse,
  removeSeries,
  renameSeries,
  saveLibrary,
  setActive,
  type Series,
  type SeriesLibrary,
} from "./seriesLibrary";

export interface UseSeriesLibrary {
  series: Series[];
  activeId: string | null;
  activeSeries: Series | null;
  activeEvents: SeriesEvent[] | null; // the dashboard prop (activeSeries?.events ?? null)
  count: number;
  filenames: string[]; // loaded source filenames (for the dup soft-warning)
  addSeriesFromParse: (filename: string, events: SeriesEvent[]) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  rename: (id: string, name: string) => void;
  select: (id: string) => void;
  lastSaveError: string | null;
}

export function useSeriesLibrary(): UseSeriesLibrary {
  const [library, setLibrary] = useState<SeriesLibrary>(() => loadLibrary());
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);

  // Persist on every change; surface a size/quota failure without throwing.
  useEffect(() => {
    const result = saveLibrary(library);
    setLastSaveError(result.ok ? null : result.message ?? "Không lưu được thư viện.");
  }, [library]);

  const addSeriesFromParse = useCallback((filename: string, events: SeriesEvent[]) => {
    setLibrary((lib) => addSeries(lib, makeSeriesFromParse(filename, events)));
  }, []);
  const remove = useCallback((id: string) => setLibrary((lib) => removeSeries(lib, id)), []);
  const clearAll = useCallback(() => setLibrary(emptyLibrary()), []);
  const rename = useCallback((id: string, name: string) => setLibrary((lib) => renameSeries(lib, id, name)), []);
  const select = useCallback((id: string) => setLibrary((lib) => setActive(lib, id)), []);

  const activeSeries = useMemo(
    () => library.series.find((s) => s.id === library.activeId) ?? null,
    [library.series, library.activeId],
  );

  return {
    series: library.series,
    activeId: library.activeId,
    activeSeries,
    activeEvents: activeSeries?.events ?? null,
    count: library.series.length,
    filenames: library.series.map((s) => s.sourceFilename),
    addSeriesFromParse,
    remove,
    clearAll,
    rename,
    select,
    lastSaveError,
  };
}
