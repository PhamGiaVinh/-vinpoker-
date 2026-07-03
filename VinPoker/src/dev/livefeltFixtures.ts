// DEV-ONLY deterministic ReplayHand fixtures for the /__dev/livefelt harness.
// Pure data — no Supabase, no hooks, no real tournament/player names. The builder
// pattern mirrors tests/trackerPoker/replayEngine.test.ts (module-local there, so
// replicated here). Stacks/blinds echo the owner's problem screenshot scale
// (100k/200k blinds, multi-million stacks) so formatStack/BB display is realistic.

import type { ReplayHand, ReplayHandAction, ReplayHandPlayer } from "@/lib/tracker-poker/replayEngine";

export type LiveFeltFixtureName = "fold-walk" | "showdown" | "allin-sidepots";

const BB = 200_000;
const SB = 100_000;

// 9-player pool; `seats` picks the first N. Ascending-ish varied stacks so the
// all-in fixture produces layered side pots (Main + Side 1..4 at 9-max).
const POOL: ReplayHandPlayer[] = [
  { player_id: "fx1", seat_number: 1, display_name: "b1a530", starting_stack: 2_900_000 },
  { player_id: "fx2", seat_number: 2, display_name: "9ec858", starting_stack: 5_400_000 },
  { player_id: "fx3", seat_number: 3, display_name: "9f9f8b", starting_stack: 8_500_000 },
  { player_id: "fx4", seat_number: 4, display_name: "9f0ef6", starting_stack: 10_300_000 },
  { player_id: "fx5", seat_number: 5, display_name: "dbbd59", starting_stack: 13_500_000 },
  { player_id: "fx6", seat_number: 6, display_name: "bcd9c1", starting_stack: 15_000_000 },
  { player_id: "fx7", seat_number: 7, display_name: "7480a0", starting_stack: 18_000_000 },
  { player_id: "fx8", seat_number: 8, display_name: "8be84c", starting_stack: 21_600_000 },
  { player_id: "fx9", seat_number: 9, display_name: "c45534", starting_stack: 35_400_000 },
];

const BOARD = ["As", "Kd", "7c", "7h", "2s"];
const HOLES: Record<string, string[]> = {
  fx1: ["Ah", "Ad"],
  fx2: ["Kc", "Kh"],
  fx3: ["Qs", "Qd"],
  fx4: ["Jc", "Jh"],
  fx5: ["Ts", "Td"],
};

function players(seats: number): ReplayHandPlayer[] {
  const n = Math.max(3, Math.min(9, seats));
  return POOL.slice(0, n).map((p) => ({ ...p }));
}

/** Sequential action builder (fresh order counter per fixture). */
function actionScript() {
  let order = 0;
  return (player_id: string, action_type: string, action_amount: number, street = "preflop"): ReplayHandAction => ({
    player_id,
    action_type,
    action_amount,
    street,
    action_order: ++order,
  });
}

/** Blinds + everyone folds to the SB → BB wins without showdown. */
function foldWalk(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const acts: ReplayHandAction[] = [A(ps[1].player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  for (let i = 3; i < ps.length; i++) acts.push(A(ps[i].player_id, "fold", 0));
  acts.push(A(ps[0].player_id, "fold", 0));
  acts.push(A(ps[1].player_id, "fold", 0)); // SB folds too → BB walks
  return { hand_number: 101, button_seat: 1, community_cards: [], big_blind: BB, players: ps, actions: acts };
}

/** Two players see a full board and show down; the rest fold preflop. */
function showdown(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const hero = ps[0]; // fx1 (AA)
  const vill = ps[1]; // fx2 (KK)
  const acts: ReplayHandAction[] = [A(vill.player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  for (let i = 3; i < ps.length; i++) acts.push(A(ps[i].player_id, "fold", 0));
  acts.push(A(hero.player_id, "raise", 3 * BB));
  acts.push(A(vill.player_id, "call", 3 * BB - SB));
  acts.push(A(ps[2 % ps.length].player_id, "fold", 0));
  acts.push(A(vill.player_id, "check", 0, "flop"));
  acts.push(A(hero.player_id, "bet", 800_000, "flop"));
  acts.push(A(vill.player_id, "call", 800_000, "flop"));
  acts.push(A(vill.player_id, "check", 0, "turn"));
  acts.push(A(hero.player_id, "bet", 2_000_000, "turn"));
  acts.push(A(vill.player_id, "call", 2_000_000, "turn"));
  acts.push(A(vill.player_id, "check", 0, "river"));
  acts.push(A(hero.player_id, "check", 0, "river"));
  // Pot = BB(dead) + 2×(3BB + 800k + 2M) = 200k + 2×3.4M = 7.0M → hero (+3.6M net).
  const pot = BB + 2 * (3 * BB + 800_000 + 2_000_000);
  const withCards = ps.map((p) =>
    p.player_id === hero.player_id
      ? { ...p, hole_cards: HOLES.fx1, ending_stack: p.starting_stack - (3 * BB + 800_000 + 2_000_000) + pot }
      : p.player_id === vill.player_id
        ? { ...p, hole_cards: HOLES.fx2, ending_stack: p.starting_stack - (3 * BB + 800_000 + 2_000_000) }
        : p
  );
  return { hand_number: 102, button_seat: 1, community_cards: BOARD, big_blind: BB, players: withCards, actions: acts };
}

/** Multi-way all-in with layered side pots: at 9-max, 5 ascending all-in stacks
 *  produce Main + Side 1–4 (the owner-screenshot shape); at 6 → 3 layers; at 3 → 2. */
function allinSidepots(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const allinCount = ps.length >= 9 ? 5 : ps.length >= 6 ? 3 : ps.length; // ascending stacks 1..k
  const acts: ReplayHandAction[] = [A(ps[1].player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  // Non-all-in seats fold first (UTG onward), then seats 1..k jam ascending.
  for (let i = allinCount; i < ps.length; i++) {
    if (i === 1 || i === 2) continue; // blinds act at the end of the script
    acts.push(A(ps[i].player_id, "fold", 0));
  }
  for (let i = 0; i < allinCount; i++) {
    const p = ps[i];
    const already = i === 1 ? SB : i === 2 ? BB : 0; // blinds already posted
    acts.push(A(p.player_id, "all_in", p.starting_stack - already));
  }
  if (allinCount < 2 || (allinCount <= 2 && ps.length > 2)) {
    // degenerate guard (never hit with seats>=3): keep the shape valid
  }
  const withCards = ps.map((p, i) => (i < allinCount ? { ...p, hole_cards: HOLES[p.player_id] ?? ["2c", "3d"] } : p));
  return { hand_number: 103, button_seat: ps.length, community_cards: BOARD, big_blind: BB, players: withCards, actions: acts };
}

export function buildFixtureHand(name: LiveFeltFixtureName, seats: number): ReplayHand {
  switch (name) {
    case "fold-walk":
      return foldWalk(seats);
    case "showdown":
      return showdown(seats);
    case "allin-sidepots":
      return allinSidepots(seats);
  }
}
