import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";

export interface ReplayHeaderMetadata {
  handNumber: number | null;
  playerCount: number | null;
  averageStack: number | null;
  potSize: number | null;
}

/** Build header metadata from one immutable replay snapshot. */
export function deriveReplayHeaderMetadata(hand: ReplayHand | null): ReplayHeaderMetadata {
  if (!hand) {
    return { handNumber: null, playerCount: null, averageStack: null, potSize: null };
  }

  const stacks = hand.players
    .map((player) => player.starting_stack)
    .filter((stack) => Number.isFinite(stack));
  const storedPotSize = hand.stored_pot_size;

  return {
    handNumber: hand.hand_number,
    playerCount: hand.players.length,
    averageStack: stacks.length > 0 ? Math.round(stacks.reduce((sum, stack) => sum + stack, 0) / stacks.length) : 0,
    potSize: typeof storedPotSize === "number" && Number.isFinite(storedPotSize) ? storedPotSize : null,
  };
}
