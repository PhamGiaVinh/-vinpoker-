const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INTERNAL_CLUB_BATCH = 10;

/**
 * Parse the optional multi-club scope sent by the internal cron caller.
 * `undefined` preserves the legacy all-approved-clubs fallback, while `[]`
 * deliberately means that the caller found no work.
 */
export function parseRequestedClubIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError("club_ids must be an array of UUID strings");
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      throw new TypeError("club_ids must contain only UUID strings");
    }
    unique.add(item.toLowerCase());
  }
  if (unique.size > MAX_INTERNAL_CLUB_BATCH) {
    throw new RangeError(`club_ids supports at most ${MAX_INTERNAL_CLUB_BATCH} clubs`);
  }
  return [...unique];
}
