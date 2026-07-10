// Tracker hand-state reducer — CLIENT display/compute copy.
//
// This is a verbatim copy of the server reducer in
//   supabase/functions/_shared/trackerEngine/handState.ts
// kept here because that module is deliberately UNreachable from the client Vite
// build (the `@tracker-engine` alias exists ONLY in vitest.config.ts, never in
// vite.config.ts — that build failure is the server-authoritative guardrail). The
// resettle-forward engine (resettleForward.ts, Phase G1) INJECTS `reduceHand`, and
// the Phase G3 UI must run it in the browser bundle, so it needs a client-reachable
// copy that stays byte-for-byte behaviourally identical to the server authority.
//
// The two copies are kept identical by a parity test:
//   tests/trackerEngine/handState.parity.test.ts
// If you change the reducer, change BOTH files in the same PR.
//
// Action-amount convention (matches HandInputPanel + potEngine): every action_amount
// is the chips ADDED by that action this street, never a "raise-to" total. So
// total_bet === Σ contributing action_amounts.

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type TrackerActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "post_sb"
  | "post_bb"
  | "post_ante";

export const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

/** Per-player seed as start_hand wrote it into hand_players. */
export interface PlayerSeed {
  player_id: string;
  seat_number: number;
  starting_stack: number;
}

/** One row from the hand_actions stream (server-trusted, already persisted). */
export interface ActionRow {
  player_id: string;
  street: Street;
  action_type: TrackerActionType;
  action_amount: number;
  action_order: number;
}

/** Reconstructed runtime state for one player after replaying the action stream. */
export interface PlayerRuntime {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  /** Chips still behind. */
  stack: number;
  /** Chips committed on the CURRENT street. */
  street_bet: number;
  /** Chips committed across ALL streets (drives pot/side-pot math). */
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
  /** Has voluntarily acted (not just posted a blind) on the current street. */
  has_acted_this_street: boolean;
}

/** Reconstructed hand-level runtime. */
export interface HandRuntime {
  players: PlayerRuntime[];
  buttonSeat: number;
  street: Street;
  /** Highest street_bet anyone has committed this street. */
  highestBet: number;
  /** Minimum legal raise INCREMENT for the next raise this street. */
  minRaise: number;
  /** Number of voluntary bets/raises seen this street (re-open tracking). */
  aggressionCount: number;
  /** Big blind as posted this hand (0 if no post_bb seen). Anchors min bet/raise. */
  bigBlind: number;
}

function clampChips(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

function seatRingFrom(players: PlayerRuntime[], afterSeat: number): PlayerRuntime[] {
  const bySeat = [...players].sort((a, b) => a.seat_number - b.seat_number);
  const idx = bySeat.findIndex((p) => p.seat_number > afterSeat);
  const start = idx === -1 ? 0 : idx;
  return [...bySeat.slice(start), ...bySeat.slice(0, start)];
}

/** A player still owes action this street: live and either hasn't acted or is short. */
function owesAction(p: PlayerRuntime, highestBet: number): boolean {
  if (p.is_folded || p.is_all_in) return false;
  return !p.has_acted_this_street || p.street_bet < highestBet;
}

/**
 * Internal mutable carrier — `lastActorSeat` is reconstruction bookkeeping not
 * exposed on HandRuntime (bigBlind IS exposed now).
 */
interface Carrier extends HandRuntime {
  lastActorSeat: number;
}

function startStreet(state: Carrier, street: Street): void {
  state.street = street;
  state.highestBet = 0;
  // Min bet/raise increment baseline = one big blind (postflop and preflop both
  // anchor on the BB; a sub-BB all-in is still legal but does not reopen).
  state.minRaise = state.bigBlind || 0;
  state.aggressionCount = 0;
  for (const p of state.players) {
    p.street_bet = 0;
    p.has_acted_this_street = false;
  }
  // First to act reference: postflop it's the seat after the button; preflop the
  // blinds will overwrite lastActorSeat as they post (so UTG = after the BB).
  if (street !== "preflop") state.lastActorSeat = state.buttonSeat;
}

function applyOne(state: Carrier, a: ActionRow): void {
  if (a.street !== state.street) startStreet(state, a.street);

  const p = state.players.find((x) => x.player_id === a.player_id);
  if (!p) return; // unknown player in stream — ignore (validation guards inserts)

  const amt = clampChips(a.action_amount);

  switch (a.action_type) {
    case "fold":
      p.is_folded = true;
      p.has_acted_this_street = true;
      break;
    case "check":
      p.has_acted_this_street = true;
      break;
    case "post_ante": {
      const moved = Math.min(amt, p.stack);
      p.stack -= moved;
      p.total_bet += moved;
      if (p.stack === 0) p.is_all_in = true;
      // Antes do not move the action pointer and are not "acting".
      return;
    }
    case "post_sb":
    case "post_bb": {
      const moved = Math.min(amt, p.stack);
      p.stack -= moved;
      p.street_bet += moved;
      p.total_bet += moved;
      if (p.stack === 0) p.is_all_in = true;
      if (a.action_type === "post_bb") state.bigBlind = Math.max(state.bigBlind, moved);
      state.highestBet = Math.max(state.highestBet, p.street_bet);
      state.minRaise = state.bigBlind || state.minRaise;
      state.lastActorSeat = p.seat_number; // after BB posts, next = UTG
      return;
    }
    case "call":
    case "bet":
    case "raise":
    case "all_in": {
      const prevHighest = state.highestBet;
      const moved = Math.min(amt, p.stack);
      p.stack -= moved;
      p.street_bet += moved;
      p.total_bet += moved;
      p.has_acted_this_street = true;
      if (p.stack === 0) p.is_all_in = true;
      if (p.street_bet > state.highestBet) {
        const increment = p.street_bet - prevHighest;
        state.highestBet = p.street_bet;
        // Only a full (>= minRaise) increment resets the bar and reopens action.
        if (increment >= state.minRaise) {
          state.minRaise = increment;
          state.aggressionCount++;
        }
      }
      state.lastActorSeat = p.seat_number;
      break;
    }
  }
}

/**
 * Replay seeds + ordered actions into a HandRuntime. Actions are sorted by
 * action_order defensively (the stream is the source of truth).
 */
export function reduceHand(
  seeds: PlayerSeed[],
  actions: ActionRow[],
  buttonSeat: number,
): HandRuntime {
  const players: PlayerRuntime[] = seeds.map((s) => ({
    player_id: s.player_id,
    seat_number: s.seat_number,
    starting_stack: clampChips(s.starting_stack),
    stack: clampChips(s.starting_stack),
    street_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
    has_acted_this_street: false,
  }));

  const state: Carrier = {
    players,
    buttonSeat,
    street: "preflop",
    highestBet: 0,
    minRaise: 0,
    aggressionCount: 0,
    lastActorSeat: buttonSeat,
    bigBlind: 0,
  };

  const ordered = [...actions].sort((a, b) => a.action_order - b.action_order);
  for (const a of ordered) applyOne(state, a);

  const { lastActorSeat: _l, ...runtime } = state;
  return runtime;
}

/**
 * The player whose turn it is on the current street, or null if the betting
 * round is complete (no live player still owes action). Clockwise from the last
 * actor. Lenient by design for live entry: heads-up preflop order is a known
 * gap (see PR notes) — turn-order is only enforced in enforce mode.
 */
export function nextToAct(
  seeds: PlayerSeed[],
  actions: ActionRow[],
  buttonSeat: number,
): string | null {
  // Re-run the reducer but keep the carrier so we know lastActorSeat.
  const players: PlayerRuntime[] = seeds.map((s) => ({
    player_id: s.player_id,
    seat_number: s.seat_number,
    starting_stack: clampChips(s.starting_stack),
    stack: clampChips(s.starting_stack),
    street_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
    has_acted_this_street: false,
  }));
  const state: Carrier = {
    players,
    buttonSeat,
    street: "preflop",
    highestBet: 0,
    minRaise: 0,
    aggressionCount: 0,
    lastActorSeat: buttonSeat,
    bigBlind: 0,
  };
  const ordered = [...actions].sort((a, b) => a.action_order - b.action_order);
  for (const a of ordered) applyOne(state, a);

  const ring = seatRingFrom(state.players, state.lastActorSeat);
  for (const p of ring) {
    if (owesAction(p, state.highestBet)) return p.player_id;
  }
  return null;
}

/** True when no live player still owes action — the street may advance. */
export function isBettingRoundComplete(runtime: HandRuntime): boolean {
  return !runtime.players.some((p) => owesAction(p, runtime.highestBet));
}

export function findPlayer(runtime: HandRuntime, playerId: string): PlayerRuntime | undefined {
  return runtime.players.find((p) => p.player_id === playerId);
}
