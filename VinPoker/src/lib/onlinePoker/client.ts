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
import type { ActionType, LobbyTableSummary, PublicHandView, PublicSeatView, WalletView } from './types';
import {
  isChipString,
  type ActionRequest,
  type ChipString,
  type RpcOutcome,
  type SubmitActionResult,
  type WireLegalActions,
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

export const bodyLegalActions = (handId: string) => ({ op: 'legal_actions' as const, handId });

export const bodySitDown = (tableId: string, seat: number, buyin: ChipString, idempotencyKey: string) =>
  ({ op: 'sit_down' as const, tableId, seat, buyin, idempotencyKey });

export const bodyStandUp = (tableId: string, idempotencyKey: string) =>
  ({ op: 'stand_up' as const, tableId, idempotencyKey });

export const bodyStartHand = (tableId: string, idempotencyKey: string) =>
  ({ op: 'start_hand' as const, tableId, idempotencyKey });

// Friends-practice (open tables, wallet-free, host succession)
export const bodyCreateOpenTable = (name: string, sb: ChipString, bb: ChipString, buyin: ChipString, maxSeats: number) =>
  ({ op: 'create_open_table' as const, name, sb, bb, buyin, maxSeats });

export const bodySitOpen = (tableId: string, seat: number, buyin: ChipString, idempotencyKey: string) =>
  ({ op: 'sit_open' as const, tableId, seat, buyin, idempotencyKey });

export const bodyTransferHost = (tableId: string, toUserId: string) =>
  ({ op: 'transfer_host' as const, tableId, toUserId });

export const bodyLeaveOpenTable = (tableId: string) =>
  ({ op: 'leave_open_table' as const, tableId });

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

  /** Server-authoritative legal-action menu for the caller's own seat (engine decides). */
  legalActions: (handId: string) =>
    invokeEdge<{ ok: boolean; legal: WireLegalActions | null; mySeat: number | null }>(bodyLegalActions(handId)),

  /** Take a seat with a play-chip buy-in. */
  sitDown: (tableId: string, seat: number, buyin: ChipString) =>
    invokeEdge<RpcOutcome>(bodySitDown(tableId, seat, buyin, newIdemKey())),

  /** Leave the table (blocked server-side while in an active hand). */
  standUp: (tableId: string) => invokeEdge<RpcOutcome>(bodyStandUp(tableId, newIdemKey())),

  /** Start a new hand at a table (≥2 seated; server deals + assigns the button). */
  startHand: (tableId: string) => invokeEdge<RpcOutcome>(bodyStartHand(tableId, newIdemKey())),

  /** Create an open practice table (caller becomes host, seated at seat 1). */
  createOpenTable: (name: string, sb: ChipString, bb: ChipString, buyin: ChipString, maxSeats = 9) =>
    invokeEdge<RpcOutcome>(bodyCreateOpenTable(name, sb, bb, buyin, maxSeats)),

  /** Sit directly at an open seat with a self-chosen stack (no wallet). */
  sitOpen: (tableId: string, seat: number, buyin: ChipString) =>
    invokeEdge<RpcOutcome>(bodySitOpen(tableId, seat, buyin, newIdemKey())),

  /** Hand the host role to another seated player (host only). */
  transferHost: (tableId: string, toUserId: string) =>
    invokeEdge<RpcOutcome>(bodyTransferHost(tableId, toUserId)),

  /** Leave an open table (wallet-free; auto-reassigns host if you were host). */
  leaveOpenTable: (tableId: string) => invokeEdge<RpcOutcome>(bodyLeaveOpenTable(tableId)),

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

/** Live lobby: open/paused tables with real seat counts. Gated by RUNTIME_LIVE. */
export async function listTablesLive(): Promise<LobbyTableSummary[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const [tablesRes, seatsRes] = await Promise.all([
    rails()
      .from('online_poker_tables')
      .select('id, name, sb, bb, max_seats, status')
      .neq('status', 'closed')
      .order('name', { ascending: true }),
    rails()
      .from('online_poker_seats')
      .select('table_id')
      .eq('status', 'sitting'),
  ]);
  if (tablesRes.error) throw new OnlinePokerError('tables_load_failed', tablesRes.error.message);
  const counts: Record<string, number> = {};
  for (const s of (seatsRes.data ?? []) as Array<{ table_id: string }>) {
    counts[String(s.table_id)] = (counts[String(s.table_id)] ?? 0) + 1;
  }
  return (tablesRes.data ?? []).map(
    (t: Record<string, unknown>): LobbyTableSummary => ({
      id: String(t.id),
      name: String(t.name ?? ''),
      sb: String(t.sb),
      bb: String(t.bb),
      maxSeats: Number(t.max_seats),
      seatedCount: counts[String(t.id)] ?? 0,
      status: t.status as LobbyTableSummary['status'],
    }),
  );
}

export interface LiveTableMeta {
  id: string;
  name: string;
  sb: string;
  bb: string;
  maxSeats: number;
  status: string;
  /** chip strings — buy-in bounds + default sit amount */
  minBuyin: string;
  maxBuyin: string;
  startingStack: string;
  /** current host (transferable; null if table has no seated players) */
  hostUserId: string | null;
}

/** Single table row by id — for the table page header when RUNTIME_LIVE. */
export async function loadTableMetaLive(tableId: string): Promise<LiveTableMeta | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await rails()
    .from('online_poker_tables')
    .select('id, name, sb, bb, max_seats, status, min_buyin, max_buyin, starting_stack_default, host_user_id')
    .eq('id', tableId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? ''),
    sb: String(data.sb),
    bb: String(data.bb),
    maxSeats: Number(data.max_seats),
    status: String(data.status),
    minBuyin: String(data.min_buyin ?? '0'),
    maxBuyin: String(data.max_buyin ?? '0'),
    startingStack: String(data.starting_stack_default ?? data.min_buyin ?? '0'),
    hostUserId: data.host_user_id ? String(data.host_user_id) : null,
  };
}

/** Current host of a table (reactive — re-read on realtime ticks). Gated. */
export async function loadTableHostLive(tableId: string): Promise<string | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data } = await rails()
    .from('online_poker_tables')
    .select('host_user_id')
    .eq('id', tableId)
    .maybeSingle();
  return data?.host_user_id ? String(data.host_user_id) : null;
}

/** The caller's play-chip wallet balance (RLS: own row only). Gated by RUNTIME_LIVE. */
export async function loadWalletLive(): Promise<WalletView> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return { balance: '0' };
  const { data } = await rails()
    .from('online_poker_player_accounts')
    .select('balance')
    .eq('user_id', uid)
    .maybeSingle();
  return { balance: data ? String(data.balance) : '0' };
}

/** A seated player at a table (exists with or WITHOUT an active hand). */
export interface LiveSeat {
  seatNo: number;
  userId: string;
  displayName?: string;
  /** chip string */
  stack: string;
  /** sitting | sitting_out | active | folded | allin */
  status: string;
}

/**
 * Live table seats from online_poker_seats (NOT the hand state) so a player can see
 * who is seated and pick an empty seat even when no hand is in progress. Gated.
 */
export async function loadSeatsLive(tableId: string): Promise<LiveSeat[]> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  const { data, error } = await rails()
    .from('online_poker_seats')
    .select('seat_no, user_id, stack, status')
    .eq('table_id', tableId)
    .in('status', ['sitting', 'sitting_out', 'active', 'folded', 'allin']);
  if (error || !data) return [];
  const rows = data as Array<{ seat_no: number; user_id: string | null; stack: number | string; status: string }>;
  const occupied = rows.filter((r) => r.user_id);

  // Best-effort display names; falls back to the seat number when unavailable.
  const ids = [...new Set(occupied.map((r) => r.user_id as string))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await rails().from('profiles').select('id, display_name').in('id', ids);
    for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
      if (p.display_name) names[p.id] = p.display_name;
    }
  }
  return occupied.map((r) => ({
    seatNo: Number(r.seat_no),
    userId: r.user_id as string,
    displayName: names[r.user_id as string],
    stack: String(r.stack),
    status: r.status,
  }));
}

/** Server-authoritative legal-action menu for the caller's seat, or null if not in the hand. */
export async function loadLegalActionsLive(handId: string): Promise<WireLegalActions | null> {
  if (!RUNTIME_LIVE) throw new RuntimeNotLiveError();
  try {
    const res = await onlinePokerClient.legalActions(handId);
    return res?.legal ?? null;
  } catch {
    return null;
  }
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
    // Carry the server's settlement summary so the client can announce the
    // winner / pot at showdown. The wire shape is structurally identical to
    // PublicHandResult; the client never recomputes it.
    ...(wire.result ? { result: wire.result } : {}),
    ...(priv ? { mySeat: priv.mySeat, myHoleCards: [...priv.myHoleCards] } : {}),
  };
}

/** A private wire view (own cards attached) -> component view-model. */
export function wirePrivateToView(wire: WirePrivateHandState): PublicHandView {
  return wirePublicToView(wire, { mySeat: wire.mySeat, myHoleCards: wire.myHoleCards });
}
