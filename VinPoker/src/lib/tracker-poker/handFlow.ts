// Tracker operator hand-flow helpers — compute "who is to act" and which actions
// are legal, from HandInputPanel's EXISTING local hand state (no server round-
// trip, no import of the server trackerEngine — that's the client-bundle
// guardrail). Drives the gold to-act highlight and the dimmed action buttons.
//
// Advisory only: the operator may always override (tap any seat) — live entry
// must never be hard-blocked just because the order differs. Mirrors the rules
// in supabase/functions/_shared/trackerEngine/{handState,validateAction}.ts.

export interface FlowPlayer {
  player_id: string;
  seat_number: number;
  /** Chips committed on the CURRENT street (reset each street). */
  current_bet: number;
  current_stack: number;
  is_folded: boolean;
  is_all_in: boolean;
}

export interface FlowInput {
  players: FlowPlayer[];
  buttonSeat: number;
  /** player_ids that have VOLUNTARILY acted on the current street. */
  actedThisStreet: Set<string>;
  /** Seat of the most recent actor this street (null → start after button). */
  lastActorSeat?: number | null;
  /** Big blind, for min-bet / min-raise guidance (0 → fall back to highest bet). */
  bigBlind?: number;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: boolean;
  bet: boolean;
  raise: boolean;
  allIn: boolean;
}

export interface ActorView {
  /** Chips this player must add to call. */
  toCall: number;
  /** Suggested minimum "raise to" amount (street total), guidance only. */
  minRaiseTo: number;
  legal: LegalActions;
}

export function highestBet(players: FlowPlayer[]): number {
  return players.reduce((m, p) => (!p.is_folded && p.current_bet > m ? p.current_bet : m), 0);
}

/** Live players (can still act) who still owe action on this street. */
function owes(p: FlowPlayer, highest: number, acted: Set<string>): boolean {
  if (p.is_folded || p.is_all_in) return false;
  return p.current_bet < highest || !acted.has(p.player_id);
}

/** Occupied seat numbers clockwise, starting at the seat AFTER `afterSeat`. */
function seatsAfter(players: FlowPlayer[], afterSeat: number): FlowPlayer[] {
  const ring = [...players].sort((a, b) => a.seat_number - b.seat_number);
  const idx = ring.findIndex((p) => p.seat_number > afterSeat);
  const start = idx === -1 ? 0 : idx;
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/**
 * The player_id whose turn it is, or null if the betting round is complete
 * (no live player still owes action). Clockwise from the last actor (or from
 * the button when nobody has acted this street yet).
 */
export function nextToAct(input: FlowInput): string | null {
  const highest = highestBet(input.players);
  const ref = input.lastActorSeat ?? input.buttonSeat;
  for (const p of seatsAfter(input.players, ref)) {
    if (owes(p, highest, input.actedThisStreet)) return p.player_id;
  }
  return null;
}

export function isBettingRoundComplete(input: FlowInput): boolean {
  const highest = highestBet(input.players);
  return !input.players.some((p) => owes(p, highest, input.actedThisStreet));
}

/**
 * Legal actions + call/min-raise amounts for a given player (defaults to the
 * next-to-act player). A folded/all-in player has no legal actions.
 */
export function actorView(input: FlowInput, playerId?: string): ActorView {
  const id = playerId ?? nextToAct(input);
  const none: ActorView = {
    toCall: 0,
    minRaiseTo: 0,
    legal: { fold: false, check: false, call: false, bet: false, raise: false, allIn: false },
  };
  if (!id) return none;
  const p = input.players.find((x) => x.player_id === id);
  if (!p || p.is_folded || p.is_all_in || p.current_stack <= 0) return none;

  const highest = highestBet(input.players);
  const toCall = Math.max(0, highest - p.current_bet);
  const bb = input.bigBlind && input.bigBlind > 0 ? input.bigBlind : 0;
  const minRaiseIncrement = bb > 0 ? bb : highest > 0 ? highest : 1;
  const minRaiseTo = highest + minRaiseIncrement;

  return {
    toCall: Math.min(toCall, p.current_stack),
    minRaiseTo,
    legal: {
      fold: true,
      check: toCall === 0,
      call: toCall > 0,
      bet: highest === 0,
      // Need chips beyond the call to make a real raise (else it's an all-in call).
      raise: highest > 0 && p.current_stack > toCall,
      allIn: p.current_stack > 0,
    },
  };
}
