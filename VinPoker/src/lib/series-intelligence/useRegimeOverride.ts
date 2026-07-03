import { useCallback, useSyncExternalStore } from "react";
import {
  commitRegimeMark,
  getRegimeSnapshot,
  setRegimeChanged,
  subscribeRegime,
  type RegimeMark,
} from "./regimeOverride";

/**
 * React binding for the LOCAL-only "regime changed" mark. Backed by useSyncExternalStore so every
 * consumer in this tab (the switch + all RegimeNotice mounts) stays in sync the instant it toggles,
 * and cross-tab via the storage event. Persists to localStorage — never the DB.
 */
export function useRegimeOverride(): {
  mark: RegimeMark;
  setChanged: (changed: boolean, note?: string) => void;
} {
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
