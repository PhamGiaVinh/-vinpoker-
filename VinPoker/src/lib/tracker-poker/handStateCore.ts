// Shared Tracker hand-state core. Both browser display code and Edge validation
// import this pure module so betting and raise-reopen rules cannot drift.

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

export interface PlayerSeed {
  player_id: string;
  seat_number: number;
  starting_stack: number;
}

export interface ActionRow {
  player_id: string;
  street: Street;
  action_type: TrackerActionType;
  /** Chips added by this action, never a raise-to total. */
  action_amount: number;
  action_order: number;
}

export interface PlayerRuntime {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  stack: number;
  street_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
  has_acted_this_street: boolean;
  /** Wager faced after this player last voluntarily acted on this street. */
  last_action_wager_level: number | null;
  /** Derived from the current wager and last full raise increment. */
  can_raise: boolean;
}

export interface HandRuntime {
  players: PlayerRuntime[];
  buttonSeat: number;
  street: Street;
  highestBet: number;
  /** Last full legal bet/raise increment for this street. */
  minRaise: number;
  aggressionCount: number;
  bigBlind: number;
}

function clampChips(value: unknown): number {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return normalized > 0 ? normalized : 0;
}

function seatRingFrom(players: PlayerRuntime[], afterSeat: number): PlayerRuntime[] {
  const bySeat = [...players].sort((left, right) => left.seat_number - right.seat_number);
  const index = bySeat.findIndex((player) => player.seat_number > afterSeat);
  const start = index === -1 ? 0 : index;
  return [...bySeat.slice(start), ...bySeat.slice(0, start)];
}

function owesAction(player: PlayerRuntime, highestBet: number): boolean {
  if (player.is_folded || player.is_all_in) return false;
  return !player.has_acted_this_street || player.street_bet < highestBet;
}

/**
 * TDA-style raise rights are player-specific. A short all-in can cumulatively
 * reopen a player only once the extra wager faced since that player's own last
 * action reaches one last-full-raise increment.
 */
export function hasRaiseRights(runtime: HandRuntime, player: PlayerRuntime): boolean {
  if (player.is_folded || player.is_all_in) return false;
  if (!player.has_acted_this_street) return true;
  if (player.last_action_wager_level === null) return false;
  return runtime.highestBet - player.last_action_wager_level >= runtime.minRaise;
}

interface Carrier extends HandRuntime {
  lastActorSeat: number;
}

function refreshRaiseRights(state: Carrier): void {
  for (const player of state.players) {
    player.can_raise = hasRaiseRights(state, player);
  }
}

function startStreet(state: Carrier, street: Street): void {
  state.street = street;
  state.highestBet = 0;
  state.minRaise = state.bigBlind || 0;
  state.aggressionCount = 0;
  for (const player of state.players) {
    player.street_bet = 0;
    player.has_acted_this_street = false;
    player.last_action_wager_level = null;
  }
  if (street !== "preflop") state.lastActorSeat = state.buttonSeat;
  refreshRaiseRights(state);
}

function applyOne(state: Carrier, action: ActionRow): void {
  if (action.street !== state.street) startStreet(state, action.street);

  const player = state.players.find((candidate) => candidate.player_id === action.player_id);
  if (!player) return;

  const amount = clampChips(action.action_amount);
  switch (action.action_type) {
    case "fold":
      player.is_folded = true;
      player.has_acted_this_street = true;
      player.last_action_wager_level = player.street_bet;
      state.lastActorSeat = player.seat_number;
      break;
    case "check":
      player.has_acted_this_street = true;
      player.last_action_wager_level = player.street_bet;
      state.lastActorSeat = player.seat_number;
      break;
    case "post_ante": {
      const moved = Math.min(amount, player.stack);
      player.stack -= moved;
      player.total_bet += moved;
      if (player.stack === 0) player.is_all_in = true;
      refreshRaiseRights(state);
      return;
    }
    case "post_sb":
    case "post_bb": {
      const moved = Math.min(amount, player.stack);
      player.stack -= moved;
      player.street_bet += moved;
      player.total_bet += moved;
      if (player.stack === 0) player.is_all_in = true;
      if (action.action_type === "post_bb") state.bigBlind = Math.max(state.bigBlind, moved);
      state.highestBet = Math.max(state.highestBet, player.street_bet);
      state.minRaise = state.bigBlind || state.minRaise;
      state.lastActorSeat = player.seat_number;
      refreshRaiseRights(state);
      return;
    }
    case "call":
    case "bet":
    case "raise":
    case "all_in": {
      const previousHighest = state.highestBet;
      const moved = Math.min(amount, player.stack);
      player.stack -= moved;
      player.street_bet += moved;
      player.total_bet += moved;
      player.has_acted_this_street = true;
      player.last_action_wager_level = player.street_bet;
      if (player.stack === 0) player.is_all_in = true;
      if (player.street_bet > previousHighest) {
        const increment = player.street_bet - previousHighest;
        state.highestBet = player.street_bet;
        if (increment >= state.minRaise) {
          state.minRaise = increment;
          state.aggressionCount += 1;
        }
      }
      state.lastActorSeat = player.seat_number;
      break;
    }
  }
  refreshRaiseRights(state);
}

function initialState(seeds: PlayerSeed[], buttonSeat: number): Carrier {
  const players: PlayerRuntime[] = seeds.map((seed) => ({
    player_id: seed.player_id,
    seat_number: seed.seat_number,
    starting_stack: clampChips(seed.starting_stack),
    stack: clampChips(seed.starting_stack),
    street_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
    has_acted_this_street: false,
    last_action_wager_level: null,
    can_raise: true,
  }));
  return {
    players,
    buttonSeat,
    street: "preflop",
    highestBet: 0,
    minRaise: 0,
    aggressionCount: 0,
    lastActorSeat: buttonSeat,
    bigBlind: 0,
  };
}

function replay(seeds: PlayerSeed[], actions: ActionRow[], buttonSeat: number): Carrier {
  const state = initialState(seeds, buttonSeat);
  for (const action of [...actions].sort((left, right) => left.action_order - right.action_order)) {
    applyOne(state, action);
  }
  return state;
}

export function reduceHand(seeds: PlayerSeed[], actions: ActionRow[], buttonSeat: number): HandRuntime {
  const { lastActorSeat: _lastActorSeat, ...runtime } = replay(seeds, actions, buttonSeat);
  return runtime;
}

export function nextToAct(seeds: PlayerSeed[], actions: ActionRow[], buttonSeat: number): string | null {
  const state = replay(seeds, actions, buttonSeat);
  for (const player of seatRingFrom(state.players, state.lastActorSeat)) {
    if (owesAction(player, state.highestBet)) return player.player_id;
  }
  return null;
}

export function isBettingRoundComplete(runtime: HandRuntime): boolean {
  return !runtime.players.some((player) => owesAction(player, runtime.highestBet));
}

export function findPlayer(runtime: HandRuntime, playerId: string): PlayerRuntime | undefined {
  return runtime.players.find((player) => player.player_id === playerId);
}
