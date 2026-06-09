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
