// Pure display formatters for the TV clock screen. Locale rules are
// hand-rolled (vi digit grouping with ".", decimal ","), not Intl-based,
// so output is identical in browser and test environments.

/** Seconds → "MM:SS", or "H:MM:SS" from one hour up. Negative clamps to 00:00. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Chip amounts with vi digit grouping: 48500 → "48.500". */
export function formatChips(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = Math.round(Math.abs(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Compact VND: 87_300_000 → "87,3Tr", 97_000_000 → "97Tr",
 * 1_500_000_000 → "1,5Tỷ", 500_000 → "500K". One decimal max, "," separator.
 */
export function formatVndCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const compact = (value: number, unit: string): string => {
    const rounded = Math.round(value * 10) / 10;
    const text = Number.isInteger(rounded)
      ? rounded.toString()
      : rounded.toString().replace(".", ",");
    return `${sign}${text}${unit}`;
  };
  if (abs >= 1_000_000_000) return compact(abs / 1_000_000_000, "Tỷ");
  if (abs >= 1_000_000) return compact(abs / 1_000_000, "Tr");
  if (abs >= 1_000) return compact(abs / 1_000, "K");
  return `${sign}${abs}`;
}

/** Average stack expressed in big blinds, rounded. Null when bb is unusable. */
export function bigBlindsOf(
  stack: number,
  bigBlind: number | null | undefined,
): number | null {
  if (!bigBlind || bigBlind <= 0) return null;
  return Math.round(stack / bigBlind);
}

/** "100/200" blinds pair with chip grouping applied to each side. */
export function formatBlinds(smallBlind: number, bigBlind: number): string {
  return `${formatChips(smallBlind)}/${formatChips(bigBlind)}`;
}
