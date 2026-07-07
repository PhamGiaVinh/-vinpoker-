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
import { isHoleCardsOk, type RpcOutcome, type WireLegalActions, type WirePrivateHandState } from './wire';
import { derivePokerSounds } from './pokerSounds';
import { deriveMySeatNo, shouldDealSignal, filterLobbyTables, isNewerHandSnap, legalFetchKey, type HandSnapId } from './tableState';
import { playPokerLiveSound } from '@/lib/pokerLiveSound';

// ── action fast-path keep-warm (Mức C) ──────────────────────────────────────
// A local constant, NOT a feature flag (scope kept small — flip here to disable). The ping
// keeps the online-poker-action isolate + GoTrue warm while a live table page is open, so
// the FIRST action after idle doesn't pay a cold start. Errors are ALWAYS swallowed: until
// the ping op is deployed the edge zod-rejects it (400), which still warms the isolate.
const ENABLE_PING_WARMUP = true;
const PING_INTERVAL_MS = 100_000;

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
      // Hide EMPTY tables from the lobby: an open table with 0 seated players is either a
      // stale leftover (created before the auto-close trigger) or one whose last player
      // just left — never something to join. A freshly created table keeps its host
      // seated (seatedCount >= 1), so this never hides a real table. (No DB write.)
      .then((t) => { if (!cancelled) { setTables(filterLobbyTables(t)); setError(null); } })
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
  /** Bumps once when a fresh hand is dealt (drives the deal animation, decoupled from the
   *  result dwell). 0 = no deal observed yet. */
  dealSignal: number;
  /** Seats that received cards on the last dealt hand (the animation flies only to these). */
  dealSeats: number[];
  refresh: () => void;
  /** Fast-path: ingest the SERVER-returned post-action state (SubmitActionOk.view) so the
   *  actor sees their own move in one round trip. NOT optimistic — the view is the engine's
   *  own output; the same high-water (handNo, stateVersion) guard orders it against polls. */
  applyServerView: (view: WirePrivateHandState, stateVersion: number) => void;
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
  // Deal-animation trigger, driven off the LIVE hand (not the dwell-held felt). Increments
  // exactly once when a fresh hand is first observed; dealSeats = the seats that got cards.
  const [dealSignal, setDealSignal] = useState(0);
  const [dealSeats, setDealSeats] = useState<number[]>([]);
  const prevDealHandIdRef = useRef<string | null>(null);
  // Cache of the caller's hole cards, keyed by handId, so the poll loop doesn't re-hit
  // the edge for cards that never change within a hand. The PUBLIC poll (which carries no
  // holes) never clears it — only a valid private view (hole fetch / applyServerView) writes
  // it, and it resets on a genuinely new hand's fetch-miss or a table change.
  const holesRef = useRef<{ handId: string; priv: { mySeat: number; myHoleCards: string[] } } | null>(null);
  // Previous hand view, kept ONLY to derive opponent-action sound cues (PR C). Starts
  // null so the first snapshot / mid-hand reconnect never plays a burst of history.
  const prevSoundHandRef = useRef<PublicHandView | null>(null);
  // HIGH-WATER mark of the newest (handNo, stateVersion) EVER INGESTED — the fast-path
  // ordering guard. Deliberately NOT "the currently visible hand": a poll returning no hand
  // clears the view but must NOT lower this mark, or a late response from an older hand
  // would resurrect it. Reset ONLY when the tableId truly changes.
  const snapRef = useRef<HandSnapId | null>(null);
  // Legal-menu fetch bookkeeping (one fetch per turn-state, stale responses dropped by key).
  const legalKeyRef = useRef<string | null>(null);
  const lastLegalOkRef = useRef<string | null>(null);
  const legalInflightRef = useRef<string | null>(null);

  // Table switch = a genuinely new world: drop every cross-hand ref (high-water included).
  useEffect(() => {
    return () => {
      snapRef.current = null;
      holesRef.current = null;
      prevSoundHandRef.current = null;
      prevDealHandIdRef.current = null;
      lastLegalOkRef.current = null;
      legalInflightRef.current = null;
    };
  }, [tableId]);

  /**
   * The ONE ingest point for hand snapshots (poll AND submit fast-path). SYNCHRONOUS by
   * contract — guard, side-effect derivations and state commits run in a single block with
   * no `await` in between, so a stale response cannot interleave between the guard check
   * and the commit (the `cancelled` flag alone cannot prevent that microtask gap).
   * Returns true iff the snapshot was accepted.
   */
  const ingestView = useCallback((view: PublicHandView, snap: HandSnapId): boolean => {
    if (!isNewerHandSnap(snapRef.current, snap)) return false;
    snapRef.current = { handNo: snap.handNo, stateVersion: snap.stateVersion };
    // Opponent-action sound cues, derived purely from prev->next (skips my own seat, which
    // sounds on submit; [] on the first snapshot). Never allowed to break the table.
    try { derivePokerSounds(prevSoundHandRef.current, view, view.mySeat ?? null).forEach(playPokerLiveSound); } catch { /* audio must never break the felt */ }
    prevSoundHandRef.current = view;
    // Deal-animation trigger: a KNOWN previous handId transitioning to a NEW empty-board
    // hand with ≥2 players. Advances the ref exactly once per accepted snapshot.
    const dealCheck = shouldDealSignal(prevDealHandIdRef.current, view);
    if (dealCheck.fire) { setDealSeats(dealCheck.dealSeats); setDealSignal((n) => n + 1); }
    if (view.handId) prevDealHandIdRef.current = view.handId;
    setHand(view);
    return true;
  }, []);

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
      const res = await loadHandStateLive(tableId);
      if (!res) {
        // No live hand: clear the VIEW + menu, but KEEP the high-water snapRef — lowering
        // it here would let a late in-flight response of an OLDER hand resurrect that hand.
        if (!cancelled) { setHand(null); setLegal(null); setError(null); }
        return;
      }
      const { wire, stateVersion } = res;
      // Hole cards are fixed for the life of a hand — fetch once per handId and reuse it
      // across polls. The public poll NEVER clears the cache (it carries no holes).
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
      // Sounds + deal signal + setHand live inside the shared SYNCHRONOUS ingest, ordered by
      // the high-water (handNo, stateVersion) guard — a stale poll response is dropped here
      // even when it slips past `cancelled` (fetch raced the submit fast-path).
      ingestView(view, { handNo: wire.config.handNo, stateVersion });
      setError(null);
    })()
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tableId, tick, ingestView]);

  // Legal-action menu — its OWN effect, ONE edge fetch per (handId, stateVersion) while it
  // is genuinely my turn (the old inline fetch re-hit the edge EVERY 1s tick on-turn, which
  // both hammered the function and queued behind submits). Contract:
  //   • success for key K → no refetch until the key changes (every action bumps
  //     state_version server-side, so a re-opened turn always makes a new key);
  //   • failure → NOT cached; the previous menu stays visible and the next tick retries;
  //   • off-turn / no hand → menu cleared immediately (key null);
  //   • a response that lands after the key moved on is DROPPED (stale menu never applies).
  const legalKey = legalFetchKey(
    hand ? { handId: hand.handId, status: hand.status, toActSeat: hand.toActSeat ?? null } : null,
    hand?.mySeat ?? null,
    snapRef.current?.stateVersion ?? null,
  );
  legalKeyRef.current = legalKey;
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    if (legalKey == null) { setLegal(null); return; }
    if (lastLegalOkRef.current === legalKey || legalInflightRef.current === legalKey) return;
    const issuedFor = legalKey;
    const handId = hand?.handId;
    if (!handId) return;
    legalInflightRef.current = issuedFor;
    loadLegalActionsLive(handId).then((lm) => {
      if (legalInflightRef.current === issuedFor) legalInflightRef.current = null;
      if (legalKeyRef.current !== issuedFor) return; // state moved on — stale menu, drop
      if (lm) { setLegal(lm); lastLegalOkRef.current = issuedFor; }
      // lm null = transient failure (loadLegalActionsLive swallows) → keep the shown menu,
      // retry on the next tick (key stays uncached).
    });
    // `tick` is a deliberate dep: it is the retry heartbeat for transient failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalKey, tick]);

  // Fast-path ingest of the server's own post-action state (SubmitActionOk.view). The actor
  // sees their move in ONE round trip; the same guard orders it against in-flight polls.
  const applyServerView = useCallback((view: WirePrivateHandState, stateVersion: number) => {
    const priv = { mySeat: view.mySeat, myHoleCards: view.myHoleCards };
    const pv = wirePublicToView(view, priv);
    const applied = ingestView(pv, { handNo: view.config.handNo, stateVersion });
    // Refresh the hole cache only when the snapshot was actually accepted — an out-of-order
    // response must never clobber a newer hand's cached holes.
    if (applied && view.config.handId) holesRef.current = { handId: view.config.handId, priv };
  }, [ingestView]);

  // Keep-warm ping — only while a live table page is mounted, skipped while hidden, ALL
  // errors swallowed (pre-deploy the edge zod-rejects the op; that reject still warms it).
  useEffect(() => {
    if (!RUNTIME_LIVE || !ENABLE_PING_WARMUP) return;
    const ping = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      onlinePokerClient.ping().catch(() => { /* silent by contract — no toast, no console */ });
    };
    ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [tableId]);

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
  // is hidden; an immediate refresh fires when it returns.
  //
  // ADAPTIVE cadence so play feels ~1s without hammering an idle table: while a hand is in
  // progress (the latency-sensitive moment — opponents acting, my menu, the showdown) poll
  // every ~1s; with NO hand (idle table waiting for players) back off to ~3s. The value only
  // flips when a hand appears/disappears, so the interval is not re-created every tick.
  const pollMs = hand ? 1000 : 3000;
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTick((n) => n + 1);
    }, pollMs);
    const onVisible = () => { if (!document.hidden) setTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [pollMs]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // My seat — AUTHORITATIVE from the live seats table (includes in-hand statuses via
  // loadSeatsLive). Deliberately NOT `hand?.mySeat`: a stale completed-hand snapshot keeps
  // mySeat set even after I've left, which used to make the client think I was still
  // seated and block re-joining (P0). Once I leave, my seat row is vacated → mySeatNo null.
  const mySeatNo = deriveMySeatNo(seats, uid);
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

  return { hand, seats, mySeatNo, myUserId: uid, hostUserId, amIHost, legal, loading, error, dealSignal, dealSeats, refresh, applyServerView, actions };
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
