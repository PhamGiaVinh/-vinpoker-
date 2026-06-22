// Tracker hand REPLAY engine — pure reducer that turns a completed hand
// (hand_players seeds + the hand_actions stream + final community cards) into an
// immutable array of frames, one per action index. Frame k = the table state
// AFTER applying actions[0..k-1], shaped to drive the existing <LiveFelt> with
// no felt changes. No React, no Supabase, no side effects → unit-testable.
//
// Action-amount convention matches T3A/T4: action_amount = chips ADDED this
// street (never a raise-to total), so running pot = Σ contributing amounts.

import { getPosition } from "@/lib/tournament/button";
import {
  computePotBreakdown,
  contributionsFromActions,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";
import {
  formatActionLabel,
  type SeatInfo,
  type ActionLog,
} from "@/components/cashier/tournament-live/LiveFelt";

export interface ReplayHandPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  starting_stack: number;
  /** Stack after the hand settled — completed hands only; enables net-win display. */
  ending_stack?: number | null;
  avatar_url?: string | null;
  hole_cards?: string[];
}

export interface ReplayHandAction {
  player_id: string;
  street: string;
  action_type: string;
  action_amount: number;
  action_order: number;
}

export interface ReplayHand {
  hand_number: number;
  button_seat: number;
  community_cards: string[];
  /** Big blind for BB display (0/undefined → no BB shown). */
  big_blind?: number;
  players: ReplayHandPlayer[];
  actions: ReplayHandAction[];
}

export interface ReplayFrame {
  /** 0..N — number of actions applied. */
  index: number;
  seats: SeatInfo[];
  /** Community cards padded to 5 ("" = empty). */
  displayCards: string[];
  /** Running pot (gross chips committed so far). */
  potSize: number;
  potBreakdown: PotBreakdown | null;
  currentStreet: string;
  /** Actor of the last applied action (felt highlights if not folded). */
  lastActorId: string | null;
  latestAction: ActionLog | null;
  /** True only on the final frame once hole cards were revealed at showdown. */
  revealHoleCards: boolean;
}

const STREETS = ["preflop", "flop", "turn", "river", "showdown"];
const CONTRIBUTING = new Set([
  "bet",
  "raise",
  "call",
  "all_in",
  "post_sb",
  "post_bb",
  "post_ante",
]);

function streetIndexOf(s: string): number {
  const i = STREETS.indexOf(s);
  return i < 0 ? 0 : i;
}

/** Cards visible at a given street index: preflop 0, flop 3, turn 4, river/showdown 5. */
function boardCount(streetIndex: number): number {
  if (streetIndex >= 3) return 5; // river + showdown
  if (streetIndex === 2) return 4; // turn
  if (streetIndex === 1) return 3; // flop
  return 0; // preflop
}

function clampChips(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 0;
  return v > 0 ? v : 0;
}

interface SeatRuntime {
  chip: number;
  folded: boolean;
  allIn: boolean;
  last?: string;
}

/**
 * Build one immutable ReplayFrame per action index (0..N). Deterministic:
 * the same hand always yields the same frames (stepping is idempotent).
 */
export function buildReplayFrames(hand: ReplayHand): ReplayFrame[] {
  const actions = [...(hand.actions || [])].sort((a, b) => a.action_order - b.action_order);
  const N = actions.length;
  const players = hand.players || [];
  const totalPlayers = players.length;
  const community = hand.community_cards || [];

  const pad5 = (cards: string[]): string[] => [
    ...cards,
    ...Array(Math.max(0, 5 - cards.length)).fill(""),
  ];
  const boardForStreet = (si: number): string[] => pad5(community.slice(0, boardCount(si)));

  const nameOf = (id: string) =>
    players.find((p) => p.player_id === id)?.display_name || id.slice(0, 6);
  const seatNumOf = (id: string) => players.find((p) => p.player_id === id)?.seat_number || 0;

  const runtime = new Map<string, SeatRuntime>();
  players.forEach((p) =>
    runtime.set(p.player_id, { chip: clampChips(p.starting_stack), folded: false, allIn: false })
  );

  let maxStreetIdx = 0;

  const makeFrame = (k: number, lastAction: ReplayHandAction | null): ReplayFrame => {
    const breakdown = computePotBreakdown(
      contributionsFromActions(actions.slice(0, k) as any)
    );
    const isFinal = k === N;
    const reveal =
      isFinal && players.some((p) => p.hole_cards && p.hole_cards.length > 0);
    const streetIndex = reveal ? 4 : maxStreetIdx;

    const seats: SeatInfo[] = players.map((p) => {
      const st = runtime.get(p.player_id)!;
      return {
        player_id: p.player_id,
        display_name: p.display_name,
        seat_number: p.seat_number,
        chip_count: Math.max(0, st.chip),
        is_active: true,
        table_id: null,
        position: getPosition(p.seat_number, hand.button_seat, totalPlayers),
        avatar_url: p.avatar_url ?? null,
        last_action: st.folded || st.allIn ? undefined : st.last,
        is_folded: st.folded,
        is_all_in: st.allIn,
        hole_cards: reveal ? p.hole_cards : undefined,
        // Net result, ONLY on the final frame (hand settled) and only when the
        // ending stack is known → drives the showdown winner badge + glow.
        net_won: isFinal && p.ending_stack != null ? p.ending_stack - clampChips(p.starting_stack) : null,
      };
    });

    const latestAction: ActionLog | null = lastAction
      ? {
          street: lastAction.street,
          player_id: lastAction.player_id,
          display_name: nameOf(lastAction.player_id),
          seat_number: seatNumOf(lastAction.player_id),
          action_type: lastAction.action_type,
          action_amount: lastAction.action_amount,
          action_order: lastAction.action_order,
        }
      : null;

    return {
      index: k,
      seats,
      displayCards: boardForStreet(streetIndex),
      potSize: breakdown.totalCommitted,
      potBreakdown: breakdown,
      currentStreet: STREETS[streetIndex],
      lastActorId: latestAction?.player_id ?? null,
      latestAction,
      revealHoleCards: reveal,
    };
  };

  const frames: ReplayFrame[] = [makeFrame(0, null)];

  for (let k = 1; k <= N; k++) {
    const a = actions[k - 1];
    const st = runtime.get(a.player_id);
    if (st && !st.folded) {
      maxStreetIdx = Math.max(maxStreetIdx, streetIndexOf(a.street));
      if (a.action_type === "fold") st.folded = true;
      if (a.action_type === "all_in") st.allIn = true;
      if (CONTRIBUTING.has(a.action_type)) {
        st.chip = Math.max(0, st.chip - clampChips(a.action_amount));
        if (st.chip === 0) st.allIn = true;
      }
      st.last = formatActionLabel({
        street: a.street,
        display_name: "",
        seat_number: 0,
        action_type: a.action_type,
        action_amount: a.action_amount,
        action_order: a.action_order,
      });
    } else if (st) {
      // A folded player should not act again; still advance street bookkeeping.
      maxStreetIdx = Math.max(maxStreetIdx, streetIndexOf(a.street));
    }
    frames.push(makeFrame(k, a));
  }

  return frames;
}

/** The frame index where each present street first appears (for street-tab jumps). */
export function streetFrameIndex(frames: ReplayFrame[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of frames) {
    if (!(f.currentStreet in map)) map[f.currentStreet] = f.index;
  }
  return map;
}

/** Derive the big blind from the hand's post_bb action when not supplied. */
export function detectBigBlind(hand: ReplayHand): number {
  if (hand.big_blind && hand.big_blind > 0) return hand.big_blind;
  const bb = (hand.actions || []).find((a) => a.action_type === "post_bb");
  return clampChips(bb?.action_amount);
}
