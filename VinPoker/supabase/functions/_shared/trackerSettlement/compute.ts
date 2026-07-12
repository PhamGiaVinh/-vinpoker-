import {
  ODD_CHIP_RULE_V1,
  SETTLEMENT_SCHEMA_V1,
  canonicalJsonV1,
  computeOutcomeHashV1,
  computeSourceChainHashV1,
  projectPublicSettlementV1,
  validateSettlementOutcomeV1,
  type PrivateSettlementOutcomeV1,
  type PublicSettlementOutcomeV1,
  type PotAllocation,
  type PrivateHandRankV1,
  type SettlementSourceHandRevisionV1,
} from "./outcomeV1.ts";
import {
  compareRankVec,
  evaluateBest,
  type HandCategoryName,
} from "../pokerEngine/evaluate.ts";
import type { Card } from "../pokerEngine/types.ts";
import { computePotBreakdown, contributionsFromActions } from "../trackerEngine/potEngine.ts";

export type SettlementDbHand = {
  id: string;
  tournament_id: string;
  hand_number: number;
  table_id: string;
  button_seat: number;
  community_cards: string[] | null;
  pot_size: number | null;
  side_pots: unknown;
  status: string;
  is_voided: boolean | null;
  updated_at: string | null;
  created_at: string;
  source_revision?: number;
};

export type SettlementDbPlayer = {
  hand_id: string;
  player_id: string;
  entry_number: number;
  seat_number: number;
  starting_stack: number;
  ending_stack: number | null;
  hole_cards: string[] | null;
  is_eliminated?: boolean | null;
};

export type SettlementDbAction = {
  id?: string;
  hand_id: string;
  player_id: string;
  entry_number: number;
  street: string;
  action_type: string;
  action_amount: number | null;
  action_order: number;
};

export type SettlementLiveStack = {
  player_id: string;
  entry_number: number;
  chip_count: number;
};

export type SettlementEdit = {
  communityCards?: string[];
  holeCards?: Array<{ player_id: string; entry_number?: number; hole_cards: string[] }>;
  actions?: SettlementDbAction[];
  potSize?: number;
  sidePots?: unknown;
};

export type SettlementHandChange = {
  hand_id: string;
  player_id: string;
  entry_number: number;
  starting_stack: number;
  ending_stack: number;
};

export type SettlementFinalStack = SettlementLiveStack & {
  expected_current: number;
};

export type AuthoritativeSettlementInput = {
  tournamentId: string;
  targetHandId: string;
  hands: readonly SettlementDbHand[];
  players: readonly SettlementDbPlayer[];
  actions: readonly SettlementDbAction[];
  liveStacks: readonly SettlementLiveStack[];
  edit?: SettlementEdit;
  actor?: { userId: string; role: string };
  sourceRevisionOverride?: number;
  sourceChainHashOverride?: string;
};

export type AuthoritativeSettlementResult = {
  privateOutcome: PrivateSettlementOutcomeV1;
  publicOutcome: PublicSettlementOutcomeV1;
  handChanges: SettlementHandChange[];
  finalStacks: SettlementFinalStack[];
  winnerIds: string[];
  affectedHandCount: number;
  affectedPlayerCount: number;
};

export type SettlementSourceRpcRow = {
  source_revision?: unknown;
  source_chain_hash?: unknown;
};

export function normalizeSettlementSourceRpcResult(value: unknown): {
  sourceRevision: number;
  sourceChainHash: string;
} {
  const row = (Array.isArray(value) ? value[0] : value) as SettlementSourceRpcRow | null | undefined;
  const sourceRevision = Number(row?.source_revision);
  const sourceChainHash = typeof row?.source_chain_hash === "string" ? row.source_chain_hash : "";
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(sourceChainHash)) {
    throw new Error("invalid_settlement_source");
  }
  return { sourceRevision, sourceChainHash };
}

const RANK_NAME: Record<number, string> = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};

function chips(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`invalid_chip:${field}`);
  }
  return value as number;
}

function revisionOf(hand: SettlementDbHand): number {
  if (Number.isSafeInteger(hand.source_revision) && (hand.source_revision as number) >= 1) {
    return hand.source_revision as number;
  }
  const parsed = hand.updated_at ? Date.parse(hand.updated_at) : 0;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonV1(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clockwise<T extends { seat_number: number }>(players: readonly T[], buttonSeat: number): T[] {
  return [...players].sort((left, right) => {
    const leftDistance = (left.seat_number - buttonSeat + 10) % 10;
    const rightDistance = (right.seat_number - buttonSeat + 10) % 10;
    return leftDistance - rightDistance || left.seat_number - right.seat_number;
  });
}

function handRank(player: SettlementDbPlayer, board: string[]): PrivateHandRankV1 | null {
  const holeCards = player.hole_cards ?? [];
  if (holeCards.length !== 2 || board.length !== 5) return null;
  const evaluated = evaluateBest([...holeCards, ...board] as Card[]);
  const kickers = evaluated.rankVec.slice(2).map((value) => RANK_NAME[value] ?? String(value));
  return {
    playerId: player.player_id,
    category: evaluated.categoryName as HandCategoryName,
    bestFive: [],
    kickers,
    isPublic: true,
    holeCards: [...holeCards],
    evaluatorInput: { rankVec: evaluated.rankVec },
  };
}

function ensureUniqueEntries(players: readonly SettlementDbPlayer[]): void {
  const entries = new Map<string, number>();
  for (const player of players) {
    const previous = entries.get(player.player_id);
    if (previous !== undefined && previous !== player.entry_number) {
      throw new Error("reentry_boundary");
    }
    entries.set(player.player_id, player.entry_number);
  }
}

function targetActions(input: AuthoritativeSettlementInput, target: SettlementDbHand): SettlementDbAction[] {
  const original = input.actions.filter((action) => action.hand_id === target.id);
  return (input.edit?.actions ?? original).map((action, index) => ({
    ...action,
    id: action.id ?? `${target.id}:${action.action_order ?? index + 1}`,
    hand_id: target.id,
  }));
}

function targetPlayers(input: AuthoritativeSettlementInput, target: SettlementDbHand): SettlementDbPlayer[] {
  const players = input.players.filter((player) => player.hand_id === target.id).map((player) => ({ ...player }));
  const holes = new Map(
    (input.edit?.holeCards ?? []).map((row) => [`${row.player_id}:${row.entry_number ?? 1}`, row.hole_cards]),
  );
  for (const player of players) {
    const edited = holes.get(`${player.player_id}:${player.entry_number}`);
    if (edited) player.hole_cards = [...edited];
  }
  return players;
}

function boardFor(input: AuthoritativeSettlementInput, target: SettlementDbHand): string[] {
  return [...(input.edit?.communityCards ?? target.community_cards ?? [])];
}

function actionSourceId(action: SettlementDbAction): string {
  return action.id ?? `${action.hand_id}:${action.action_order}`;
}

function sourceActionForRefund(actions: readonly SettlementDbAction[], playerId: string): SettlementDbAction {
  const candidates = actions
    .filter((action) => action.player_id === playerId)
    .sort((left, right) => right.action_order - left.action_order);
  const source = candidates.find((action) => ["bet", "raise", "all_in"].includes(action.action_type)) ?? candidates[0];
  if (!source) throw new Error("refund_source_action_missing");
  return source;
}

async function sourceChain(input: AuthoritativeSettlementInput): Promise<{
  sourceChain: PrivateSettlementOutcomeV1["privateEvidence"]["sourceChain"];
  sourceChainHash: string;
}> {
  const sortedHands = [...input.hands].sort((left, right) => left.hand_number - right.hand_number || left.id.localeCompare(right.id));
  const sourceChain: SettlementSourceHandRevisionV1[] = [];
  for (const hand of sortedHands) {
    const handPlayers = input.players.filter((player) => player.hand_id === hand.id).sort((a, b) => a.seat_number - b.seat_number);
    const handActions = input.actions.filter((action) => action.hand_id === hand.id).sort((a, b) => a.action_order - b.action_order);
    const sourceHash = await sha256Json({ hand, players: handPlayers, actions: handActions });
    const sourceRevision = hand.id === input.targetHandId && input.sourceRevisionOverride !== undefined
      ? input.sourceRevisionOverride
      : revisionOf(hand);
    sourceChain.push({ handId: hand.id, handNumber: hand.hand_number, sourceRevision, sourceHash });
  }
  const target = input.hands.find((hand) => hand.id === input.targetHandId);
  if (!target) throw new Error("target_hand_not_found");
  return {
    sourceChain,
    sourceChainHash: await computeSourceChainHashV1({
      targetHandId: target.id,
      buttonSeat: target.button_seat,
      communityCards: boardFor(input, target),
      seats: [],
      actions: [],
      sourceChain,
      externalAdjustments: [],
      holeCardsByPlayer: {},
      muckedHoleCardsByPlayer: {},
    }),
  };
}

export async function computeAuthoritativeSettlement(
  input: AuthoritativeSettlementInput,
): Promise<AuthoritativeSettlementResult> {
  const sortedHands = [...input.hands].sort((left, right) => left.hand_number - right.hand_number || left.id.localeCompare(right.id));
  const targetIndex = sortedHands.findIndex((hand) => hand.id === input.targetHandId);
  if (targetIndex < 0) throw new Error("target_hand_not_found");
  const chain = sortedHands.slice(targetIndex);
  if (chain.some((hand) => hand.status === "in_progress" || hand.is_voided)) throw new Error("invalid_chain_state");
  ensureUniqueEntries(input.players);

  const target = chain[0];
  const players = targetPlayers(input, target);
  const actions = targetActions(input, target);
  const board = boardFor(input, target);
  if (players.length === 0) throw new Error("target_players_missing");

  const contributions = contributionsFromActions(actions);
  const contributionByPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  for (const player of players) {
    const starting = chips(player.starting_stack, `${player.player_id}.starting_stack`);
    const committed = contributionByPlayer.get(player.player_id)?.total_bet ?? 0;
    if (committed > starting) throw new Error("target_action_exceeds_stack");
  }
  const breakdown = computePotBreakdown(contributions);
  if (breakdown.pots.length === 0) throw new Error("empty_pot");
  const folded = new Set(contributions.filter((row) => row.is_folded).map((row) => row.player_id));
  const awards = new Map<string, number>();
  const potAllocations: PotAllocation[] = [];
  const ranks: PrivateHandRankV1[] = [];
  const winnerIds = new Set<string>();

  for (const [potIndex, layer] of breakdown.pots.entries()) {
    const eligible = players.filter((player) => layer.eligible_player_ids.includes(player.player_id) && !folded.has(player.player_id));
    if (eligible.length === 0) throw new Error("pot_has_no_eligible_player");
    let winners: SettlementDbPlayer[];
    if (eligible.length === 1) {
      winners = eligible;
    } else {
      if (board.length !== 5 || eligible.some((player) => (player.hole_cards ?? []).length !== 2)) throw new Error("incomplete_showdown_cards");
      const ranked = eligible.map((player) => ({ player, rank: evaluateBest([...(player.hole_cards as string[]), ...board] as Card[]).rankVec }));
      const best = ranked.reduce((value, item) => compareRankVec(item.rank, value) > 0 ? item.rank : value, ranked[0].rank);
      winners = ranked.filter((item) => compareRankVec(item.rank, best) === 0).map((item) => item.player);
      for (const player of eligible) {
        const rank = handRank(player, board);
        if (rank) ranks.push(rank);
      }
    }
    const ordered = clockwise(winners, target.button_seat);
    const share = Math.floor(layer.amount / ordered.length);
    const odd = layer.amount - share * ordered.length;
    for (const [winnerIndex, winner] of ordered.entries()) {
      const amount = share + (winnerIndex < odd ? 1 : 0);
      const potId = potIndex === 0 ? "main-0" : `side-${potIndex}`;
      potAllocations.push({ potId, winnerId: winner.player_id, amount, includesOddChip: winnerIndex < odd });
      awards.set(winner.player_id, (awards.get(winner.player_id) ?? 0) + amount);
      winnerIds.add(winner.player_id);
    }
  }

  const refund = breakdown.uncalled ? breakdown.uncalled.amount : 0;
  const refunds = breakdown.uncalled
    ? [{ playerId: breakdown.uncalled.player_id, amount: refund, sourceActionId: actionSourceId(sourceActionForRefund(actions, breakdown.uncalled.player_id)) }]
    : [];
  if (breakdown.uncalled) awards.set(breakdown.uncalled.player_id, awards.get(breakdown.uncalled.player_id) ?? 0);

  const ending = new Map<string, number>();
  for (const player of players) {
    const starting = chips(player.starting_stack, `${player.player_id}.starting_stack`);
    const committed = contributionByPlayer.get(player.player_id)?.total_bet ?? 0;
    ending.set(player.player_id, starting - committed + (awards.get(player.player_id) ?? 0) + (breakdown.uncalled?.player_id === player.player_id ? refund : 0));
  }
  const startingTotal = players.reduce((sum, player) => sum + chips(player.starting_stack, `${player.player_id}.starting_stack`), 0);
  const endingTotal = [...ending.values()].reduce((sum, value) => sum + value, 0);
  if (startingTotal !== endingTotal) throw new Error("target_not_conserved");

  const handChanges: SettlementHandChange[] = [];
  const carry = new Map<string, number>();
  const oldDelta = new Map<string, number>();
  const newDelta = new Map<string, number>();
  for (const player of players) {
    const oldEnding = chips(player.ending_stack ?? 0, `${player.player_id}.ending_stack`);
    const nextEnding = ending.get(player.player_id)!;
    if ((oldEnding === 0) !== (nextEnding === 0)) throw new Error("bust_state_change_requires_void");
    carry.set(player.player_id, nextEnding);
    oldDelta.set(player.player_id, oldEnding);
    newDelta.set(player.player_id, nextEnding);
    if (oldEnding !== nextEnding) handChanges.push({ hand_id: target.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: chips(player.starting_stack, `${player.player_id}.starting_stack`), ending_stack: nextEnding });
  }
  for (const later of chain.slice(1)) {
    const laterPlayers = input.players.filter((player) => player.hand_id === later.id);
    const laterActions = input.actions.filter((action) => action.hand_id === later.id);
    const laterContributions = new Map(contributionsFromActions(laterActions).map((row) => [row.player_id, row.total_bet]));
    for (const player of laterPlayers) {
      const oldStart = chips(player.starting_stack, `${player.player_id}.starting_stack`);
      const oldEnd = chips(player.ending_stack ?? 0, `${player.player_id}.ending_stack`);
      const newStart = carry.get(player.player_id) ?? oldStart;
      const committed = laterContributions.get(player.player_id) ?? 0;
      if (committed > newStart) throw new Error(`later_hand_action_exceeds_stack:${later.hand_number}`);
      const newEnd = newStart + (oldEnd - oldStart);
      if (newEnd < 0 || (oldEnd === 0) !== (newEnd === 0)) throw new Error(`later_hand_state_divergence:${later.hand_number}`);
      carry.set(player.player_id, newEnd);
      oldDelta.set(player.player_id, oldEnd);
      newDelta.set(player.player_id, newEnd);
      if (newStart !== oldStart || newEnd !== oldEnd) handChanges.push({ hand_id: later.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: newStart, ending_stack: newEnd });
    }
  }

  const finalStacks: SettlementFinalStack[] = [];
  for (const [playerId, next] of newDelta) {
    const live = input.liveStacks.find((row) => row.player_id === playerId);
    if (!live) throw new Error(`live_stack_missing:${playerId}`);
    const expected = chips(live.chip_count, `${playerId}.live_stack`);
    const delta = next - (oldDelta.get(playerId) ?? expected);
    const chipCount = expected + delta;
    if (chipCount < 0) throw new Error(`live_stack_negative:${playerId}`);
    finalStacks.push({ ...live, expected_current: expected, chip_count: chipCount });
  }

  const chainData = await sourceChain(input);
  const targetEvidence = {
    targetHandId: target.id,
    buttonSeat: target.button_seat,
    communityCards: board,
    seats: players.map((player) => ({ seatNumber: player.seat_number, playerId: player.player_id, startingStack: chips(player.starting_stack, `${player.player_id}.starting_stack`) })),
    actions: actions.map((action) => ({ actionId: actionSourceId(action), actionOrder: action.action_order, playerId: action.player_id, street: action.street, actionType: action.action_type, amount: chips(action.action_amount ?? 0, `${actionSourceId(action)}.amount`) })),
    sourceChain: chainData.sourceChain,
    externalAdjustments: [],
    holeCardsByPlayer: Object.fromEntries(players.filter((player) => (player.hole_cards ?? []).length === 2).map((player) => [player.player_id, player.hole_cards!])),
    muckedHoleCardsByPlayer: {},
    actor: input.actor,
  };
  const privateOutcome: PrivateSettlementOutcomeV1 = {
    schemaVersion: SETTLEMENT_SCHEMA_V1,
    status: "verified",
    sourceRevision: input.sourceRevisionOverride ?? revisionOf(target),
    sourceChainHash: input.sourceChainHashOverride ?? chainData.sourceChainHash,
    settlementRevision: 1,
    outcomeHash: "0".repeat(64),
    ruleVersion: ODD_CHIP_RULE_V1,
    players: players.map((player) => {
      const startingStack = chips(player.starting_stack, `${player.player_id}.starting_stack`);
      const committedTotal = contributionByPlayer.get(player.player_id)?.total_bet ?? 0;
      const potAward = awards.get(player.player_id) ?? 0;
      const playerRefund = breakdown.uncalled?.player_id === player.player_id ? refund : 0;
      const creditedTotal = potAward + playerRefund;
      const netDelta = creditedTotal - committedTotal;
      return { playerId: player.player_id, startingStack, committedTotal, potAward, refund: playerRefund, creditedTotal, netDelta, externalDelta: 0, endingStack: startingStack + netDelta };
    }),
    pots: breakdown.pots.map((pot, index) => ({
      potId: index === 0 ? "main-0" : `side-${index}`,
      kind: index === 0 ? "main" as const : "side" as const,
      amount: pot.amount,
      eligiblePlayerIds: [...pot.eligible_player_ids],
      winnerIds: potAllocations.filter((allocation) => allocation.potId === (index === 0 ? "main-0" : `side-${index}`)).map((allocation) => allocation.winnerId),
      allocations: potAllocations.filter((allocation) => allocation.potId === (index === 0 ? "main-0" : `side-${index}`)),
    })),
    refunds,
    handRanks: ranks,
    totals: {
      startingStack: startingTotal,
      committedTotal: breakdown.totalCommitted,
      distributablePot: breakdown.totalPot,
      refundTotal: refund,
      potAward: potAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
      creditedTotal: breakdown.totalPot + refund,
      netDelta: 0,
      externalDelta: 0,
      endingStack: endingTotal,
    },
    privateEvidence: targetEvidence,
  };
  privateOutcome.outcomeHash = await computeOutcomeHashV1(privateOutcome);
  const validation = validateSettlementOutcomeV1(privateOutcome);
  if (!validation.ok) throw new Error(`settlement_contract_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  return {
    privateOutcome,
    publicOutcome: projectPublicSettlementV1(privateOutcome),
    handChanges,
    finalStacks,
    winnerIds: [...winnerIds],
    affectedHandCount: new Set(handChanges.map((change) => change.hand_id)).size,
    affectedPlayerCount: new Set(handChanges.map((change) => change.player_id)).size,
  };
}
