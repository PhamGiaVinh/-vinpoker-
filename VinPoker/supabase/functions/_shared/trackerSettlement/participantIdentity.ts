export type EntryIdentity = {
  player_id: string;
  entry_number: number;
};

export type EntryKey = `${string}#${number}`;

export function entryKey(identity: EntryIdentity): EntryKey {
  if (!identity.player_id || !Number.isSafeInteger(identity.entry_number) || identity.entry_number < 1) {
    throw new Error("invalid_entry_identity");
  }
  return `${identity.player_id}#${identity.entry_number}`;
}

/** Seat numbers increase clockwise. The first seat after the button receives the first odd chip. */
export function orderClockwiseAfterButton<T extends { seat_number: number }>(
  participants: readonly T[],
  buttonSeat: number,
): T[] {
  return [...participants].sort((left, right) => {
    const leftWrap = left.seat_number > buttonSeat ? 0 : 1;
    const rightWrap = right.seat_number > buttonSeat ? 0 : 1;
    return leftWrap - rightWrap || left.seat_number - right.seat_number;
  });
}
