/**
 * Canonicalise a Vietnamese phone number for player-history dedup.
 *
 * This is a BYTE-FOR-BYTE mirror of the SQL `public.normalize_phone(text)` in migration
 * `20261208000000_player_identity_canonical.sql`. The client uses it only for optimistic
 * display / lookup keys; the database function is the source of truth for the unique index.
 * Keep the two in lock-step — if you change one, change the other.
 *
 * Rules (in order):
 *   1. strip every non-digit character;
 *   2. empty  -> null (no anchor);
 *   3. leading country code "84" (e.g. +84 912 345 678) -> replace with a single "0";
 *   4. a bare 9-digit subscriber number (e.g. "912345678") -> prepend "0";
 *   5. otherwise return the digits unchanged (already "0…").
 *
 * All of "0912345678" / "+84 912 345 678" / "0912 345 678" / "912345678" collapse to "0912345678".
 */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input ?? '').replace(/[^0-9]/g, '');
  if (digits === '') return null;
  let d = digits;
  if (d.startsWith('84')) {
    d = '0' + d.slice(2);
  } else if (d.length === 9 && d[0] !== '0') {
    d = '0' + d;
  }
  return d;
}
