// supabase/functions/online-poker-action/log.ts
//
// Structured, G1-safe observability for online-poker-action. LOCAL to this function
// (never imported from _shared) so the logging change stays scoped to one edge function.
//
// G1 (locked): a log line may carry ONLY the whitelisted, non-secret keys below. The
// builder DROPS every other key before serialising — so even if a caller mistakenly
// passes `holes`, `deck`, `board_future`, a private view, or an RPC `data` blob, none of
// it can reach the log. Hole cards, board_future, deck, private views, JWT/session,
// user email, and player names are NEVER loggable. The only fields ever emitted are a
// correlation id, the op, hand_id/table_id (uuids), a machine outcome code, latency, the
// http status, and the CAS attempt count.

/** A fresh per-request correlation id. Groups a request's CAS retries under one id. */
export function newCid(): string {
  return crypto.randomUUID();
}

/** Monotonic clock for latency in ms. Present in both Deno (edge) and Node (vitest). */
export function now(): number {
  return performance.now();
}

/** The ONLY keys a log line may carry. Anything else is dropped by buildLog. */
export const ALLOWED_FIELDS = [
  "cid",
  "op",
  "hand_id",
  "table_id",
  "outcome",
  "http",
  "ms",
  "attempt",
] as const;

export type LogEvt = "op_done" | "op_error";

/**
 * Build one structured log line. WHITELIST-ONLY: `evt` is always first, then only the
 * keys in ALLOWED_FIELDS that are present (non-null) survive — every other key in
 * `fields` is silently dropped. `ms` is rounded to an integer. Returns a compact JSON
 * string ready for console.log / console.error. This is the G1 safety net at the code
 * layer: secrets cannot leak even if a caller passes them in.
 */
export function buildLog(evt: LogEvt, fields: Record<string, unknown>): string {
  const safe: Record<string, unknown> = { evt };
  for (const k of ALLOWED_FIELDS) {
    const v = fields[k];
    if (v === undefined || v === null) continue;
    safe[k] = k === "ms" && typeof v === "number" ? Math.round(v) : v;
  }
  return JSON.stringify(safe);
}
