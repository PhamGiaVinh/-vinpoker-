export const FLOOR_TABLE_NUMBER_MIN = 1;
export const FLOOR_TABLE_NUMBER_MAX = 100;
export const FIXED_FLOOR_TABLE_SEATS = 9;

export type FloorTableNumberState = "available" | "active" | "closed";

export interface FloorTableCatalogRow {
  table_number: number | null;
  status: string | null;
}

export interface FloorTableNumberOption {
  number: number;
  state: FloorTableNumberState;
}

export interface FloorRosterSeat {
  seatNumber: number;
  playerName: string;
  chipsLabel: string;
  entryNumber?: number | null;
}

export interface FloorRosterSlot {
  seatNumber: number;
  seat: FloorRosterSeat | null;
}

/**
 * Builds the visible 1–100 picker from the server-returned tournament catalog.
 * An active row always wins over a historical closed row for the same number.
 * The RPC still revalidates the chosen number under the tournament lock.
 */
export function buildFloorTableNumberOptions(
  rows: readonly FloorTableCatalogRow[],
): FloorTableNumberOption[] {
  const stateByNumber = new Map<number, FloorTableNumberState>();

  for (const row of rows) {
    const number = row.table_number;
    if (
      number == null
      || !Number.isInteger(number)
      || number < FLOOR_TABLE_NUMBER_MIN
      || number > FLOOR_TABLE_NUMBER_MAX
    ) {
      continue;
    }

    const nextState: FloorTableNumberState = row.status === "active" ? "active" : "closed";
    if (nextState === "active" || !stateByNumber.has(number)) {
      stateByNumber.set(number, nextState);
    }
  }

  return Array.from(
    { length: FLOOR_TABLE_NUMBER_MAX },
    (_, index): FloorTableNumberOption => {
      const number = index + FLOOR_TABLE_NUMBER_MIN;
      return { number, state: stateByNumber.get(number) ?? "available" };
    },
  );
}

/**
 * Floor table detail is intentionally a fixed nine-seat operational roster.
 * Duplicate seat numbers are surfaced to the UI instead of silently choosing
 * one player, because the database/Edge projection is authoritative.
 */
export function buildFloorSeatRoster(
  seats: readonly FloorRosterSeat[],
): {
  slots: FloorRosterSlot[];
  duplicateSeatNumbers: number[];
  outOfRangeSeatNumbers: number[];
} {
  const bySeat = new Map<number, FloorRosterSeat>();
  const duplicates = new Set<number>();
  const outOfRange = new Set<number>();

  for (const seat of seats) {
    if (
      !Number.isInteger(seat.seatNumber)
      || seat.seatNumber < 1
      || seat.seatNumber > FIXED_FLOOR_TABLE_SEATS
    ) {
      outOfRange.add(seat.seatNumber);
      continue;
    }
    if (bySeat.has(seat.seatNumber)) {
      duplicates.add(seat.seatNumber);
      continue;
    }
    bySeat.set(seat.seatNumber, seat);
  }

  return {
    slots: Array.from(
      { length: FIXED_FLOOR_TABLE_SEATS },
      (_, index): FloorRosterSlot => {
        const seatNumber = index + 1;
        return { seatNumber, seat: bySeat.get(seatNumber) ?? null };
      },
    ),
    duplicateSeatNumbers: Array.from(duplicates).sort((a, b) => a - b),
    outOfRangeSeatNumbers: Array.from(outOfRange).sort((a, b) => a - b),
  };
}
