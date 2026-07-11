import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  commitRegimeMark,
  getRegimeSnapshot,
  setActiveRegimeClub,
  setRegimeChanged,
  subscribeRegime,
  type RegimeMark,
} from "./regimeOverride";

/**
 * React binding for the LOCAL-only "regime changed" mark. Backed by useSyncExternalStore so every
 * consumer in this tab (the switch + all RegimeNotice mounts) stays in sync the instant it toggles,
 * and cross-tab via the storage event. Persists to localStorage — never the DB.
 *
 * TP8: pass a `clubId` (only the flag-gated setter does) to scope the mark PER-CLUB; readers (RegimeNotice)
 * call with no arg and follow the active club. Omitting clubId leaves the active club unchanged (global by
 * default) — i.e. with seriesRegimeTripwire off this is exactly the pre-TP8 global behavior.
 */
export function useRegimeOverride(clubId?: string): {
  mark: RegimeMark;
  setChanged: (changed: boolean, note?: string) => void;
} {
  useEffect(() => {
    if (clubId !== undefined) setActiveRegimeClub(clubId);
  }, [clubId]);
  const mark = useSyncExternalStore(subscribeRegime, getRegimeSnapshot, getRegimeSnapshot);
  const setChanged = useCallback(
    (changed: boolean, note?: string) => {
      const now = new Date().toISOString();
      commitRegimeMark(setRegimeChanged(getRegimeSnapshot(), changed, note ?? getRegimeSnapshot().note, now));
    },
    [],
  );
  return { mark, setChanged };
}
