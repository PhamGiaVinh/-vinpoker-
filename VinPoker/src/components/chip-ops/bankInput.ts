/** Counts sent to bigint-backed chip bank RPCs must be exact non-negative integers. */
export function parseChipCountInput(value: string, allowZero = false): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  if (!Number.isSafeInteger(count) || (!allowZero && count === 0)) return null;
  return count;
}
