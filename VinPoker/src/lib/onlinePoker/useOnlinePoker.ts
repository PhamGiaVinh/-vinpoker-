// src/lib/onlinePoker/useOnlinePoker.ts
// Online-poker data hooks (friends-practice model). They expose ONE shape to the UI
// and switch their source on RUNTIME_LIVE:
//   * dark (RUNTIME_LIVE === false) -> deterministic mock; no network, ever.
//   * live (RUNTIME_LIVE === true)  -> direct rail reads + realtime + edge actions.
// No wallet: players self-set their chips. The first sitter is the host; the host is
// transferable and auto-reassigns when it leaves (server-side, via op_* RPCs).

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Rebuy a fresh stack after busting (server-dictated amount; busted-only). */
  rebuy: (amount: string) => Promise<RpcOutcome>;
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
  // Cache of the caller's hole cards, keyed by handId, so the poll loop doesn't re-hit
  // the edge for cards that never change within a hand.
  const holesRef = useRef<{ handId: string; priv: { mySeat: number; myHoleCards: string[] } } | null>(null);

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
      // Hole cards are fixed for the life of a hand — fetch once per handId and reuse it
      // across polls so the 2.5s loop doesn't hit the edge for cards every tick.
      let priv: { mySeat: number; myHoleCards: string[] } | undefined;
      if (holesRef.current && holesRef.current.handId === wire.config.handId) {
        priv = holesRef.current.priv;
      } else {
        try {
          const hc = (await onlinePokerClient.getMyHoleCards(wire.config.handId)) as RpcOutcome;
          if (isHoleCardsOk(hc)) {
            priv = { mySeat: hc.seat, myHoleCards: hc.cards };
            holesRef.current = { handId: wire.config.handId, priv };
          }
        } catch { /* not seated / disabled — render public-only, no overlay */ }
      }
      const view = wirePublicToView(wire, priv);
      if (cancelled) return;
      setHand(view);
      setError(null);
      // Legal menu only when it is genuinely my turn. Keep the previous menu on a
      // transient fetch failure so the action bar never flickers empty mid-turn.
      if (priv && view.status === 'betting' && view.toActSeat === priv.mySeat) {
        try {
          const lm = await loadLegalActionsLive(wire.config.handId);
          if (!cancelled) setLegal(lm);
        } catch { /* keep the previous menu */ }
      } else if (!cancelled) {
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

  // Polling fallback (live only): realtime postgres_changes can drop or lag, which would
  // freeze the opponent on stale state even though the engine already advanced the hand.
  // A steady poll guarantees both clients converge to server truth. Paused while the tab
  // is hidden; an immediate refresh fires when it returns. (~2.5s mirrors the Tracker
  // Live Action Engine fast-poll.)
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTick((n) => n + 1);
    }, 2500);
    const onVisible = () => { if (!document.hidden) setTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // My seat: prefer the in-hand seat; else the seats table by uid.
  const mySeatNo = hand?.mySeat ?? seats.find((s) => s.userId === uid)?.seatNo ?? null;
  const amIHost = !!uid && hostUserId === uid;

  // Liveness heartbeat (live + seated): ping the server every ~10s so the stale-seat
  // reaper can free this seat if the tab dies. Fires immediately on sitting and on
  // return-from-background to keep last_seen_at fresh. Wrapped so it cleanly NO-OPS until
  // op_heartbeat exists live (migration 20260923000000 is source-only) — degrades like
  // any other gated feature; never throws into the UI.
  useEffect(() => {
    if (!RUNTIME_LIVE || mySeatNo == null) return;
    const ping = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      // op_heartbeat isn't in the generated DB types yet (source-only) — cast + swallow.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.rpc as any)('op_heartbeat', { p_table_id: tableId }).then(() => {}, () => {});
    };
    ping(); // immediate, so a freshly-claimed seat is marked live at once
    const id = setInterval(ping, 10000);
    const onVisible = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [tableId, mySeatNo]);

  const actions: TableHandActions = {
    sitOpen: (seat, buyin) => onlinePokerClient.sitOpen(tableId, seat, buyin),
    leaveTable: () => onlinePokerClient.leaveOpenTable(tableId),
    transferHost: (toUserId) => onlinePokerClient.transferHost(tableId, toUserId),
    submitAction: (a) => onlinePokerClient.submitAction(a),
    rebuy: (amount) => onlinePokerClient.rebuyOpen(tableId, amount),
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
