// src/lib/onlinePoker/useOnlinePoker.ts
// Online-poker data hooks (friends-practice model). They expose ONE shape to the UI
// and switch their source on RUNTIME_LIVE:
//   * dark (RUNTIME_LIVE === false) -> deterministic mock; no network, ever.
//   * live (RUNTIME_LIVE === true)  -> direct rail reads + realtime + edge actions.
// No wallet: players self-set their chips. The first sitter is the host; the host is
// transferable and auto-reassigns when it leaves (server-side, via op_* RPCs).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from './types';
import type { ActionType, LobbyTableSummary, PublicHandView } from './types';
import { MOCK_TABLES, mockHand } from './mockData';
import {
  listTablesLive,
  loadHandStateLive,
  loadTableMetaLive,
  loadTableHostLive,
  loadSeatsLive,
  loadLegalActionsLive,
  onlinePokerClient,
  wirePublicToView,
  type LiveTableMeta,
  type LiveSeat,
} from './client';
import { isHoleCardsOk, type RpcOutcome, type WireLegalActions } from './wire';

// ── lobby ──────────────────────────────────────────────────────────────────

export interface LobbyState {
  tables: LobbyTableSummary[];
  loading: boolean;
  error: string | null;
  /** Create an open practice table (caller becomes host). Returns the RPC outcome. */
  createTable: (name: string, sb: string, bb: string, buyin: string, maxSeats?: number) => Promise<RpcOutcome>;
  refresh: () => void;
}

export function useLobby(): LobbyState {
  const [tables, setTables] = useState<LobbyTableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!RUNTIME_LIVE) {
      setTables(MOCK_TABLES);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    listTablesLive()
      .then((t) => { if (!cancelled) { setTables(t); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  // Live: a new/closed table or seat change refreshes the lobby grid.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel('op-lobby')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_tables' }, () => setTick((n) => n + 1))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_seats' }, () => setTick((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const createTable = useCallback(
    (name: string, sb: string, bb: string, buyin: string, maxSeats = 9) =>
      onlinePokerClient.createOpenTable(name, sb, bb, buyin, maxSeats),
    [],
  );

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { tables, loading, error, createTable, refresh };
}

// ── single table / hand ──────────────────────────────────────────────────────

export interface TableHandActions {
  /** Sit directly at an empty seat with a self-chosen stack (no wallet). */
  sitOpen: (seat: number, buyin: string) => Promise<RpcOutcome>;
  /** Leave the table (wallet-free; auto-reassigns host if you were host). */
  leaveTable: () => Promise<RpcOutcome>;
  /** Hand the host role to another seated player (host only). */
  transferHost: (toUserId: string) => Promise<RpcOutcome>;
  submitAction: (a: { handId: string; seat: number; type: ActionType; amount?: string }) => Promise<unknown>;
}

export interface TableHandState {
  hand: PublicHandView | null;
  /** Live table seats (occupied), independent of any active hand. */
  seats: LiveSeat[];
  /** The caller's seat number at this table, or null if not seated. */
  mySeatNo: number | null;
  /** The caller's auth user id (live only). */
  myUserId: string | null;
  /** Current host user id (reactive). */
  hostUserId: string | null;
  /** True when the caller is the current host. */
  amIHost: boolean;
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
  const [hostUserId, setHostUserId] = useState<string | null>(null);
  const [legal, setLegal] = useState<WireLegalActions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Resolve the caller's uid once (live only) — used to find my seat / host.
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

  // Load table seats + current host (live). Seats exist even with no active hand.
  useEffect(() => {
    if (!RUNTIME_LIVE) { setSeats([]); setHostUserId(null); return; }
    let cancelled = false;
    loadSeatsLive(tableId).then((s) => { if (!cancelled) setSeats(s); }).catch(() => {});
    loadTableHostLive(tableId).then((h) => { if (!cancelled) setHostUserId(h); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tableId, tick]);

  // Live realtime: re-pull on any change to this table's hands, seats OR table row
  // (the table row carries host_user_id changes). Dark: no-op.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel(`op-table-${tableId}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_hands', filter: `table_id=eq.${tableId}` }, () => setTick((n) => n + 1))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_seats', filter: `table_id=eq.${tableId}` }, () => setTick((n) => n + 1))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'online_poker_tables', filter: `id=eq.${tableId}` }, () => setTick((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tableId]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // My seat: prefer the in-hand seat; else the seats table by uid.
  const mySeatNo = hand?.mySeat ?? seats.find((s) => s.userId === uid)?.seatNo ?? null;
  const amIHost = !!uid && hostUserId === uid;

  const actions: TableHandActions = {
    sitOpen: (seat, buyin) => onlinePokerClient.sitOpen(tableId, seat, buyin),
    leaveTable: () => onlinePokerClient.leaveOpenTable(tableId),
    transferHost: (toUserId) => onlinePokerClient.transferHost(tableId, toUserId),
    submitAction: (a) => onlinePokerClient.submitAction(a),
  };

  return { hand, seats, mySeatNo, myUserId: uid, hostUserId, amIHost, legal, loading, error, refresh, actions };
}

// ── table metadata ─────────────────────────────────────────────────────────

/** Table header data (name, sb, bb, buyin bounds). Dark = mock lookup; live = DB fetch. */
export function useTableMeta(tableId: string): LiveTableMeta | null {
  const mockRow = MOCK_TABLES.find((t) => t.id === tableId);
  const mockMeta: LiveTableMeta | null = mockRow
    ? {
        id: mockRow.id, name: mockRow.name, sb: mockRow.sb, bb: mockRow.bb,
        maxSeats: mockRow.maxSeats, status: mockRow.status,
        minBuyin: String(Number(mockRow.bb) * 20), maxBuyin: String(Number(mockRow.bb) * 200),
        startingStack: String(Number(mockRow.bb) * 40), hostUserId: null,
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
