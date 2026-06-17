// src/lib/onlinePoker/useOnlinePoker.ts
// GE-2D — data hooks for the online-poker shell. They expose ONE shape to the UI
// and switch their source on RUNTIME_LIVE:
//   * dark (RUNTIME_LIVE === false) -> deterministic mock; no network, ever.
//   * live (RUNTIME_LIVE === true)  -> direct rail reads + realtime + edge actions.
// The pages render identically in both modes; enablement is wiring the live branch,
// not a rewrite. Action methods throw RuntimeNotLiveError while dark (the buttons
// are already disabled by RUNTIME_LIVE, so they are never actually invoked).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from './types';
import type { ActionType, LobbyTableSummary, PublicHandView, WalletView } from './types';
import { MOCK_TABLES, MOCK_WALLET, mockHand } from './mockData';
import {
  listTablesLive,
  loadHandStateLive,
  loadTableMetaLive,
  loadSeatsLive,
  loadWalletLive,
  loadLegalActionsLive,
  onlinePokerClient,
  wirePublicToView,
  RuntimeNotLiveError,
  type LiveTableMeta,
  type LiveSeat,
} from './client';
import { isHoleCardsOk, type RpcOutcome, type WireLegalActions } from './wire';

// ── lobby ──────────────────────────────────────────────────────────────────

export interface LobbyState {
  tables: LobbyTableSummary[];
  wallet: WalletView;
  loading: boolean;
  error: string | null;
  /** Daily play-chip grant. Inert (throws) while dark; the button is disabled. */
  claimDaily: () => Promise<void>;
  refresh: () => void;
}

export function useLobby(): LobbyState {
  const [tables, setTables] = useState<LobbyTableSummary[]>([]);
  const [wallet, setWallet] = useState<WalletView>(MOCK_WALLET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!RUNTIME_LIVE) {
      // Dark: render the fixed mock lobby, no network.
      setTables(MOCK_TABLES);
      setWallet(MOCK_WALLET);
      setLoading(false);
      setError(null);
      return;
    }
    // Live: load open tables + the caller's real play-chip wallet.
    setLoading(true);
    Promise.all([
      listTablesLive(),
      loadWalletLive().catch(() => MOCK_WALLET),
    ])
      .then(([t, w]) => { if (!cancelled) { setTables(t); setWallet(w); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const claimDaily = useCallback(async () => {
    if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
    await onlinePokerClient.claimDailyChips();
    setTick((n) => n + 1);
  }, []);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { tables, wallet, loading, error, claimDaily, refresh };
}

// ── single table / hand ──────────────────────────────────────────────────────

export interface TableHandActions {
  sitDown: (seat: number, buyin: string) => Promise<RpcOutcome>;
  standUp: () => Promise<RpcOutcome>;
  startHand: () => Promise<RpcOutcome>;
  submitAction: (a: { handId: string; seat: number; type: ActionType; amount?: string }) => Promise<unknown>;
  claimDaily: () => Promise<RpcOutcome>;
}

export interface TableHandState {
  hand: PublicHandView | null;
  /** Live table seats (occupied), independent of any active hand. */
  seats: LiveSeat[];
  /** The caller's seat number at this table, or null if not seated. */
  mySeatNo: number | null;
  /** The caller's play-chip wallet. */
  wallet: WalletView;
  /** Server legal-action menu when it is the caller's turn; else null. */
  legal: WireLegalActions | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  actions: TableHandActions;
}

export function useTableHand(tableId: string): TableHandState {
  const [hand, setHand] = useState<PublicHandView | null>(null);
  const [seats, setSeats] = useState<LiveSeat[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletView>(MOCK_WALLET);
  const [legal, setLegal] = useState<WireLegalActions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Resolve the caller's uid once (live only) — used to find my seat.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => { if (!cancelled) setUid(data?.user?.id ?? null); });
    return () => { cancelled = true; };
  }, []);

  // Load hand (mock while dark; public rail read + private overlay while live).
  useEffect(() => {
    let cancelled = false;
    if (!RUNTIME_LIVE) {
      setHand(mockHand(tableId));
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    (async () => {
      const wire = await loadHandStateLive(tableId);
      if (!wire) { if (!cancelled) { setHand(null); setLegal(null); setError(null); } return; }
      let priv: { mySeat: number; myHoleCards: string[] } | undefined;
      try {
        const hc = (await onlinePokerClient.getMyHoleCards(wire.config.handId)) as RpcOutcome;
        if (isHoleCardsOk(hc)) priv = { mySeat: hc.seat, myHoleCards: hc.cards };
      } catch { /* not seated / disabled — render public-only, no overlay */ }
      const view = wirePublicToView(wire, priv);
      if (cancelled) return;
      setHand(view);
      setError(null);
      // When it's MY turn, fetch the server-authoritative legal menu; else clear.
      if (priv && view.status === 'betting' && view.toActSeat === priv.mySeat) {
        const lm = await loadLegalActionsLive(wire.config.handId);
        if (!cancelled) setLegal(lm);
      } else {
        setLegal(null);
      }
    })()
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tableId, tick]);

  // Load table seats + wallet (live). Seats exist even with no active hand.
  useEffect(() => {
    if (!RUNTIME_LIVE) { setSeats([]); setWallet(MOCK_WALLET); return; }
    let cancelled = false;
    loadSeatsLive(tableId).then((s) => { if (!cancelled) setSeats(s); }).catch(() => {});
    loadWalletLive().then((w) => { if (!cancelled) setWallet(w); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tableId, tick]);

  // Live realtime: re-pull on any change to this table's hands OR seats. Dark: no-op.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel(`op-table-${tableId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'online_poker_hands', filter: `table_id=eq.${tableId}` },
        () => setTick((n) => n + 1),
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'online_poker_seats', filter: `table_id=eq.${tableId}` },
        () => setTick((n) => n + 1),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tableId]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // My seat: prefer the in-hand seat; else the seats table by uid.
  const mySeatNo = hand?.mySeat ?? seats.find((s) => s.userId === uid)?.seatNo ?? null;

  const actions: TableHandActions = {
    sitDown: (seat, buyin) => onlinePokerClient.sitDown(tableId, seat, buyin),
    standUp: () => onlinePokerClient.standUp(tableId),
    startHand: () => onlinePokerClient.startHand(tableId),
    submitAction: (a) => onlinePokerClient.submitAction(a),
    claimDaily: () => onlinePokerClient.claimDailyChips(),
  };

  return { hand, seats, mySeatNo, wallet, legal, loading, error, refresh, actions };
}

// ── table metadata ─────────────────────────────────────────────────────────

/** Table header data (name, sb, bb). Dark = mock lookup; live = DB fetch. */
export function useTableMeta(tableId: string): LiveTableMeta | null {
  const mockRow = MOCK_TABLES.find((t) => t.id === tableId);
  const mockMeta: LiveTableMeta | null = mockRow
    ? {
        id: mockRow.id, name: mockRow.name, sb: mockRow.sb, bb: mockRow.bb,
        maxSeats: mockRow.maxSeats, status: mockRow.status,
        minBuyin: String(Number(mockRow.bb) * 20), maxBuyin: String(Number(mockRow.bb) * 200),
        startingStack: String(Number(mockRow.bb) * 40),
      }
    : null;

  const [meta, setMeta] = useState<LiveTableMeta | null>(RUNTIME_LIVE ? null : mockMeta);

  useEffect(() => {
    if (!RUNTIME_LIVE) { setMeta(mockMeta); return; }
    let cancelled = false;
    loadTableMetaLive(tableId)
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { if (!cancelled) setMeta(null); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  return meta;
}
