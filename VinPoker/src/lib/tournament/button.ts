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
