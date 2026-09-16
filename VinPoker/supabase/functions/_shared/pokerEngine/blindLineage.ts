export interface BlindLineageInput {
  maxSeats: number;
  occupiedSeats: number[];
  previousDealtSeats: number[];
  previousButtonSeat: number | null;
  previousSbPosition: number | null;
  previousBbSeat: number | null;
}

export interface BlindLineagePlacement {
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  deadButton: boolean;
  deadSb: boolean;
}

/** Blind positions, not adjacent physical seat numbers, advance to the next hand. */
export function nextButtonFromBlindLineage({
  maxSeats, occupiedSeats, previousDealtSeats,
  previousButtonSeat, previousSbPosition, previousBbSeat,
}: BlindLineageInput): BlindLineagePlacement | null {
  if (!Number.isInteger(maxSeats) || maxSeats < 2 || maxSeats > 10) return null;
  const validSeat = (seat: number | null): seat is number =>
    seat !== null && Number.isInteger(seat) && seat >= 1 && seat <= maxSeats;
  if (!validSeat(previousButtonSeat) || !validSeat(previousSbPosition) || !validSeat(previousBbSeat)) return null;
  const previouslyDealt = [...new Set(previousDealtSeats)]
    .filter((seat) => Number.isInteger(seat) && seat >= 1 && seat <= maxSeats);
  if (previouslyDealt.length < 2 || !previouslyDealt.includes(previousBbSeat)) return null;
  const occupied = [...new Set(occupiedSeats)]
    .filter((seat) => Number.isInteger(seat) && seat >= 1 && seat <= maxSeats)
    .sort((left, right) => left - right);
  if (occupied.length < 2) return null;

  if (occupied.length === 2) {
    if (!occupied.includes(previousBbSeat)) return null;
    const other = occupied.find((seat) => seat !== previousBbSeat);
    if (other == null) return null;
    return { buttonSeat: previousBbSeat, sbSeat: previousBbSeat, bbSeat: other, deadButton: false, deadSb: false };
  }

  const sbDistance = (previousSbPosition - previousButtonSeat + maxSeats) % maxSeats;
  const bbDistance = (previousBbSeat - previousButtonSeat + maxSeats) % maxSeats;
  if (sbDistance === 0 || bbDistance <= sbDistance) return null;
  const bbSeat = occupied.find((seat) => seat > previousBbSeat) ?? occupied[0];
  if (bbSeat === previousBbSeat) return null;
  return {
    buttonSeat: previousSbPosition,
    sbSeat: occupied.includes(previousBbSeat) ? previousBbSeat : null,
    bbSeat,
    deadButton: !occupied.includes(previousSbPosition),
    deadSb: !occupied.includes(previousBbSeat),
  };
}
