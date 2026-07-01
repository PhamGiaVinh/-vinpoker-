// Series Intelligence — CAPTURE v0 privacy utility. Registration capture stores an OPAQUE hash of a player
// identifier, NEVER the raw value (privacy lock). This hashes client-side before insert; the raw string must
// never reach the DB payload. Displayed only as a short prefix. NOTE: SHA-256 of a small identifier space
// (e.g. a phone) is still brute-forceable — a per-club salt/pepper is a future hardening; keep it opaque for now.

/** Deliberate normalization so the same person reconciles later: trim + lowercase. */
export function normalizePlayerRef(raw: string): string {
  return raw.trim().toLowerCase();
}

/** SHA-256 hex of the normalized identifier (Web Crypto; browser + modern Node). Raw never returned. */
export async function hashPlayerRef(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizePlayerRef(raw));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Short, non-reversible display form for a stored hash (list rows show only this + the ref type). */
export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 10)}…` : "—";
}
