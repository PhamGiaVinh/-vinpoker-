export type ExpectedTargetEndingStack = {
  player_id: string;
  entry_number: number;
  ending_stack: number;
};

export type TargetSettlementPlayer = {
  player_id: string;
  entry_number: number;
  starting_stack: number;
};

type EndingStackOutcome = {
  players: readonly { playerId: string; endingStack: number }[];
};

const identity = (playerId: string, entryNumber: number) => `${playerId}:${entryNumber}`;

function isChip(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The operator's observed end stacks are a proof target, never an instruction
 * to move chips. Require an exact identity/value match with the server replay
 * before the database writer receives anything.
 */
export function assertExpectedTargetEndingStacks(input: {
  expected: readonly ExpectedTargetEndingStack[];
  targetPlayers: readonly TargetSettlementPlayer[];
  outcome: EndingStackOutcome;
}): void {
  const target = new Map<string, TargetSettlementPlayer>();
  let startingTotal = 0;
  for (const player of input.targetPlayers) {
    if (!player.player_id || !Number.isSafeInteger(player.entry_number) || player.entry_number < 1 || !isChip(player.starting_stack)) {
      throw new Error("invalid_target_player_stack");
    }
    const key = identity(player.player_id, player.entry_number);
    if (target.has(key)) throw new Error("duplicate_target_player");
    target.set(key, player);
    startingTotal += player.starting_stack;
  }
  if (target.size === 0 || input.expected.length !== target.size) throw new Error("expected_target_stack_identity_mismatch");

  const outcomeByPlayerId = new Map(input.outcome.players.map((player) => [player.playerId, player]));
  if (outcomeByPlayerId.size !== target.size) throw new Error("server_target_stack_identity_mismatch");

  const seen = new Set<string>();
  let expectedTotal = 0;
  for (const row of input.expected) {
    if (!row.player_id || !Number.isSafeInteger(row.entry_number) || row.entry_number < 1 || !isChip(row.ending_stack)) {
      throw new Error("invalid_expected_ending_stack");
    }
    const key = identity(row.player_id, row.entry_number);
    if (!target.has(key) || seen.has(key)) throw new Error("expected_target_stack_identity_mismatch");
    seen.add(key);
    expectedTotal += row.ending_stack;
    const server = outcomeByPlayerId.get(row.player_id);
    if (!server || server.endingStack !== row.ending_stack) {
      throw new Error("expected_target_stack_mismatch");
    }
  }
  if (seen.size !== target.size) throw new Error("expected_target_stack_identity_mismatch");
  if (expectedTotal !== startingTotal) throw new Error("expected_target_stack_not_conserved");
}

/** Redacted receipt payload: IDs and chip counts only, never cards or proof data. */
export function redactedTargetEndingStacks(input: {
  targetPlayers: readonly TargetSettlementPlayer[];
  outcome: EndingStackOutcome;
}): ExpectedTargetEndingStack[] {
  const outcomeByPlayerId = new Map(input.outcome.players.map((player) => [player.playerId, player.endingStack]));
  return input.targetPlayers.map((player) => {
    const endingStack = outcomeByPlayerId.get(player.player_id);
    if (!isChip(endingStack)) throw new Error("server_target_stack_identity_mismatch");
    return {
      player_id: player.player_id,
      entry_number: player.entry_number,
      ending_stack: endingStack,
    };
  });
}
