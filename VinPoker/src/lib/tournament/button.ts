const POSITION_NAMES: Record<number, string[]> = {
  2: ["BTN/SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "CO"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "LJ", "HJ"],
  7: ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "UTG+1", "LJ", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO"],
  10: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "MP+1", "LJ", "HJ", "CO"],
}

export function getPosition(seat: number, btnSeat: number, total: number): string {
  if (total <= 1) return ""
  const offset = ((seat - btnSeat + total) % total)
  const names = POSITION_NAMES[total]
  if (names && offset < names.length) {
    return names[offset]
  }
  return `+${offset}`
}

/**
 * Map every OCCUPIED seat to its full poker position, robust to non-contiguous
 * seat numbers (e.g. seats 1,3,5,7). Unlike getPosition (which does raw
 * seat−btn mod total and mislabels when seats have gaps), this orders the
 * occupied seats clockwise from the button and assigns POSITION_NAMES in order.
 * `activeSeats` = the seats dealt into the hand. Returns Map<seatNumber, name>.
 */
export function getSeatPositions(activeSeats: number[], btnSeat: number): Map<number, string> {
  const seats = [...new Set(activeSeats)]
    .filter((s) => Number.isInteger(s) && s > 0)
    .sort((a, b) => a - b)
  const result = new Map<number, string>()
  const count = seats.length
  if (count === 0) return result
  if (count === 1) {
    result.set(seats[0], "BTN")
    return result
  }

  // Rotate so the button seat is first. If the button is on an empty seat,
  // start at the next occupied seat clockwise.
  let start = seats.indexOf(btnSeat)
  if (start < 0) {
    const nextHigher = seats.findIndex((s) => s > btnSeat)
    start = nextHigher < 0 ? 0 : nextHigher
  }

  const names = POSITION_NAMES[count]
  for (let i = 0; i < count; i++) {
    const seat = seats[(start + i) % count]
    result.set(seat, names && i < names.length ? names[i] : `+${i}`)
  }
  return result
}

export function nextButton(activeSeats: number[], currentBtn: number): number {
  const sorted = [...new Set(activeSeats)]
    .filter((seat) => Number.isInteger(seat) && seat > 0)
    .sort((a, b) => a - b)

  if (sorted.length === 0) return 1
  if (sorted.length === 1) return sorted[0]

  const idx = sorted.indexOf(currentBtn)

  if (idx >= 0) {
    return sorted[(idx + 1) % sorted.length]
  }

  const nextHigher = sorted.find((seat) => seat > currentBtn)
  return nextHigher ?? sorted[0]
}
