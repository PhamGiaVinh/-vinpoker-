// src/lib/onlinePoker/client.ts
// GE-2D — the client transport for online poker. This is the single place the web
// UI talks to the GE-2C runtime. It is DARK by construction: every method that
// would hit the network first checks RUNTIME_LIVE and throws RuntimeNotLiveError
// while false, so the shell can never reach the backend until the runtime is live.
//
// Two paths, both gated:
//   * intent/writes + secret hole cards -> the `online-poker-action` Edge function
//     (op-discriminated body; the edge runs the engine and routes through op_* RPCs).
//   * public reads (lobby tables, public hand state) -> direct supabase selects on
//     the realtime-published online_poker_* rails (no secrets ever cross this path).
//
// Anti-drift: the request bodies are built by the pure `body*` helpers below, which
// tests/onlinePoker/client.test.ts asserts field-for-field against the edge's Zod
// schema. The wire view shapes live in ./wire.ts (a hand-maintained server mirror).

import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_LIVE } from './types';
import type { ActionType, LobbyTableSummary, PublicHandView, PublicSeatView } from './types';
import {
  isChipString,
  type ActionRequest,
  type ChipString,
  type RpcOutcome,
  type SubmitActionResult,
  type WirePublicHandState,
  type WirePrivateHandState,
} from './wire';

// ── errors ───────────────────────────────────────────────────────────────────

/** Thrown by any network method while the runtime is dark (RUNTIME_LIVE === false). */
export class RuntimeNotLiveError extends Error {
  constructor() {
    super('online poker runtime is not live (RUNTIME_LIVE=false)');
    this.name = 'RuntimeNotLiveError';
  }
}

/** A failed edge/RPC call. `code` is the stable machine code where one exists. */
export class OnlinePokerError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'OnlinePokerError';
    this.code = code;
  }
}

// ── idempotency keys ─────────────────────────────────────────────────────────

/** A per-attempt idempotency key (UUID v4 — satisfies the edge's min(8) IdemKey). */
export function newIdemKey(): string {
  return crypto.randomUUID();
}

// ── pure request-body builders (no network — unit-tested while dark) ─────────
// Each returns the EXACT body the edge's discriminated-union Zod schema expects.

export const bodyClaimDaily = () => ({ op: 'claim_daily_chips' as const });

export const bodyGetHole = (handId: string) => ({ op: 'get_my_hole_cards' as const, handId });

export const bodySitDown = (tableId: string, seat: number, buyin: ChipString, idempotencyKey: string) =>
  ({ op: 'sit_down' as const, tableId, seat, buyin, idempotencyKey });

export const bodyStandUp = (tableId: string, idempotencyKey: string) =>
  ({ op: 'stand_up' as const, tableId, idempotencyKey });

export const bodyStartHand = (tableId: string, idempotencyKey: string) =>
  ({ op: 'start_hand' as const, tableId, idempotencyKey });

export function bodySubmitAction(req: ActionRequest) {
  // bet/raise must carry a canonical chip amount; reject malformed before the wire.
  if ((req.type === 'bet' || req.type === 'raise') && !isChipString(req.amount)) {
    throw new OnlinePokerError('bad_request', 'bet/raise requires a valid chip amount');
  }
  if (req.amount !== undefined && !isChipString(req.amount)) {
    throw new OnlinePokerError('bad_request', 'invalid chip amount');
  }
  return {
    op: 'submit_action' as const,
    handId: req.handId,
    seat: req.seat,
    type: req.type,
    ...(req.amount !== undefined ? { amount: req.amount } : {}),
    idempotencyKey: req.idempotencyKey,
    ...(req.expectedSeq !== undefined ? { expectedSeq: req.expectedSeq } : {}),
  };
}

// ── edge invocation (gated) ──────────────────────────────────────────────────

/**
 * Invoke the online-poker Edge function with an op-body. THROWS RuntimeNotLiveError
 * while dark — it never reaches the network until RUNTIME_LIVE flips true.
 */
async function invokeEdge<T>(body: Record<string, unknown>): Promise<T> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await supabase.functions.invoke('online-poker-action', { body });
  if (error) throw new OnlinePokerError('edge_error', error.message);
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new OnlinePokerError(String((data as { error: unknown }).error));
  }
  return data as T;
}

// ── public client surface ────────────────────────────────────────────────────

export const onlinePokerClient = {
  /** Daily play-chip grant (idempotent per UTC day, server-side). */
  claimDailyChips: () => invokeEdge<RpcOutcome>(bodyClaimDaily()),

  /** The caller's OWN hole cards for a hand (deny-all secrets, auth.uid()-scoped). */
  getMyHoleCards: (handId: string) => invokeEdge<RpcOutcome>(bodyGetHole(handId)),

  /** Take a seat with a play-chip buy-in. */
  sitDown: (tableId: string, seat: number, buyin: ChipString) =>
    invokeEdge<RpcOutcome>(bodySitDown(tableId, seat, buyin, newIdemKey())),

  /** Leave the table (blocked server-side while in an active hand). */
  standUp: (tableId: string) => invokeEdge<RpcOutcome>(bodyStandUp(tableId, newIdemKey())),

  /** Start a new hand at a table (≥2 seated; server deals + assigns the button). */
  startHand: (tableId: string) => invokeEdge<RpcOutcome>(bodyStartHand(tableId, newIdemKey())),

  /** Submit an action intent; the server re-validates with the engine. */
  submitAction: (req: Omit<ActionRequest, 'idempotencyKey'> & { idempotencyKey?: string }) =>
    invokeEdge<SubmitActionResult>(
      bodySubmitAction({ ...req, idempotencyKey: req.idempotencyKey ?? newIdemKey() }),
    ),
};

export type OnlinePokerClient = typeof onlinePokerClient;

// ── public reads (direct rails; gated) ───────────────────────────────────────
// online_poker_* tables are not in the generated Database type yet (regen owed), so
// reads cross an explicit untyped boundary. These run ONLY on the live path.

/** Untyped supabase accessor for the not-yet-generated online_poker_* rails. */
function rails() {
  return supabase as unknown as {
    from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/** Live lobby: open/paused tables with seat counts. Gated by RUNTIME_LIVE. */
export async function listTablesLive(): Promise<LobbyTableSummary[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await rails()
    .from('online_poker_tables')
    .select('id, name, sb, bb, max_seats, status')
    .neq('status', 'closed')
    .order('created_at', { ascending: true });
  if (error) throw new OnlinePokerError('tables_load_failed', error.message);
  return (data ?? []).map(
    (t: Record<string, unknown>): LobbyTableSummary => ({
      id: String(t.id),
      name: String(t.name ?? ''),
      sb: String(t.sb),
      bb: String(t.bb),
      maxSeats: Number(t.max_seats),
      seatedCount: 0, // joined separately from online_poker_seats when wired live
      status: t.status as LobbyTableSummary['status'],
    }),
  );
}

/** Live public hand state for a table's current hand (no secrets). Gated. */
export async function loadHandStateLive(tableId: string): Promise<WirePublicHandState | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await rails()
    .from('online_poker_hands')
    .select('state')
    .eq('table_id', tableId)
    .in('status', ['dealing', 'betting'])
    .order('hand_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new OnlinePokerError('hand_load_failed', error.message);
  return (data?.state as WirePublicHandState) ?? null;
}

// ── wire -> component view-model mapping (pure) ───────────────────────────────

/**
 * Project a public (or private) wire hand state down to the component view-model
 * (PublicHandView). Secrecy is preserved by construction: the public wire carries
 * no hole cards, so a seat's `myHoleCards` only appears when `priv` is supplied for
 * the caller's own seat. `displayName` is resolved elsewhere (profile lookup).
 */
export function wirePublicToView(
  wire: WirePublicHandState,
  priv?: { mySeat: number; myHoleCards: string[] },
): PublicHandView {
  const seats: PublicSeatView[] = wire.seats.map((s) => ({
    seat: s.seat,
    playerId: s.playerId,
    stack: s.stack,
    committed: s.committed,
    status: s.status,
    revealedCards: s.revealedCards,
    isButton: s.seat === wire.buttonSeat,
    isToAct: s.seat === wire.toAct,
  }));
  return {
    handId: wire.config.handId,
    tableId: wire.config.tableId,
    handNo: wire.config.handNo,
    street: wire.street,
    board: [...wire.board],
    pot: wire.pot,
    toActSeat: wire.toAct,
    buttonSeat: wire.buttonSeat,
    status: wire.status,
    seats,
    ...(priv ? { mySeat: priv.mySeat, myHoleCards: [...priv.myHoleCards] } : {}),
  };
}

/** A private wire view (own cards attached) -> component view-model. */
export function wirePrivateToView(wire: WirePrivateHandState): PublicHandView {
  return wirePublicToView(wire, { mySeat: wire.mySeat, myHoleCards: wire.myHoleCards });
}
