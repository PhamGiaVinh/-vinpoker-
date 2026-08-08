import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type TournamentOpsSnapshot = {
  tournamentId: string;
  clubId: string;
  tournamentName: string;
  status: string;
};

type TournamentOpsContextValue = {
  snapshot: TournamentOpsSnapshot;
  revision: number;
  stale: boolean;
  conflict: string | null;
  refreshSnapshot: () => void;
  markStale: () => void;
  clearConflict: () => void;
  reportConflict: (code: string) => void;
};

const TournamentOpsContext = createContext<TournamentOpsContextValue | null>(null);

/**
 * Shared tournament workspace seam. The scope gate creates this provider only
 * after the server has proved that the selected tournament belongs to the
 * selected club. Child workspaces therefore never need to guess a club.
 */
export function TournamentOpsProvider({
  snapshot,
  children,
}: {
  snapshot: TournamentOpsSnapshot;
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const [stale, setStale] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const refreshSnapshot = useCallback(() => {
    setRevision((value) => value + 1);
    setStale(false);
    setConflict(null);
  }, []);
  const markStale = useCallback(() => setStale(true), []);
  const clearConflict = useCallback(() => setConflict(null), []);
  const reportConflict = useCallback((code: string) => setConflict(code), []);

  const value = useMemo<TournamentOpsContextValue>(() => ({
    snapshot,
    revision,
    stale,
    conflict,
    refreshSnapshot,
    markStale,
    clearConflict,
    reportConflict,
  }), [clearConflict, conflict, markStale, refreshSnapshot, reportConflict, revision, snapshot, stale]);

  return <TournamentOpsContext.Provider value={value}>{children}</TournamentOpsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTournamentOps(): TournamentOpsContextValue {
  const value = useContext(TournamentOpsContext);
  if (!value) throw new Error("useTournamentOps must be used inside TournamentOpsProvider.");
  return value;
}
