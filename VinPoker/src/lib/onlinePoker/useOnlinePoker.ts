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
  onlinePokerClient,
  wirePublicToView,
  RuntimeNotLiveError,
} from './client';
import { isHoleCardsOk, type RpcOutcome } from './wire';

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
    // Live: load open tables. Wallet comes from the player-account read (wired at
    // enablement); kept on MOCK_WALLET shape until then.
    setLoading(true);
    listTablesLive()
      .then((t) => { if (!cancelled) { setTables(t); setError(null); } })
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
}

export interface TableHandState {
  hand: PublicHandView | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  actions: TableHandActions;
}

export function useTableHand(tableId: string): TableHandState {
  const [hand, setHand] = useState<PublicHandView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Load (mock while dark; public rail read + private overlay while live).
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
      if (!wire) { if (!cancelled) { setHand(null); setError(null); } return; }
      let priv: { mySeat: number; myHoleCards: string[] } | undefined;
      try {
        const hc = (await onlinePokerClient.getMyHoleCards(wire.config.handId)) as RpcOutcome;
        if (isHoleCardsOk(hc)) priv = { mySeat: hc.seat, myHoleCards: hc.cards };
      } catch { /* not seated / disabled — render public-only, no overlay */ }
      if (!cancelled) { setHand(wirePublicToView(wire, priv)); setError(null); }
    })()
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tableId, tick]);

  // Live: re-pull on any change to this table's hands (realtime). Dark: no-op.
  useEffect(() => {
    if (!RUNTIME_LIVE) return;
    const channel = supabase
      .channel(`op-hand-${tableId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'online_poker_hands', filter: `table_id=eq.${tableId}` },
        () => setTick((n) => n + 1),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tableId]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const actions: TableHandActions = {
    sitDown: (seat, buyin) => onlinePokerClient.sitDown(tableId, seat, buyin),
    standUp: () => onlinePokerClient.standUp(tableId),
    startHand: () => onlinePokerClient.startHand(tableId),
    submitAction: (a) => onlinePokerClient.submitAction(a),
  };

  return { hand, loading, error, refresh, actions };
}
