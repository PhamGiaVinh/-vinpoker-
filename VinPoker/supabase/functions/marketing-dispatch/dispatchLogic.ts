// marketing-dispatch — PURE decision logic (no I/O, no Deno, no Supabase).
// Extracted so it can be unit-tested with `deno test` without any env / network.
// See dispatchLogic.test.ts.

export type ChannelName = "telegram" | "facebook" | "zalo";

const KNOWN_CHANNELS: ReadonlySet<string> = new Set(["telegram", "facebook", "zalo"]);

/** Channels for which a real adapter exists in P0. Facebook/Zalo are deliberately absent
 *  (P0 = Telegram-only) — the schedule RPC already refuses unconfigured channels, but the
 *  dispatcher stays defensive and never silently "skips" an unsupported channel. */
export const IMPLEMENTED_CHANNELS: ReadonlySet<ChannelName> = new Set<ChannelName>(["telegram"]);

/** Parse + validate a post's `channels` jsonb into a clean, de-duplicated channel list. */
export function parseChannels(raw: unknown): ChannelName[] {
  if (!Array.isArray(raw)) return [];
  const out: ChannelName[] = [];
  for (const v of raw) {
    if (typeof v === "string" && KNOWN_CHANNELS.has(v) && !out.includes(v as ChannelName)) {
      out.push(v as ChannelName);
    }
  }
  return out;
}

/** Which requested channels still need a send attempt this tick — i.e. not already delivered.
 *  `alreadySent` is the set of channels whose post_channel_status.status is already 'sent'
 *  (skip-if-sent, the exactly-once guard alongside the UNIQUE(post_id, channel) constraint). */
export function channelsNeedingSend(requested: ChannelName[], alreadySent: Iterable<string>): ChannelName[] {
  const sent = new Set<string>(alreadySent);
  return requested.filter((c) => !sent.has(c));
}

/** Final post status from the count of successfully-sent channels vs the total requested.
 *  A post is 'sent' only when EVERY requested channel delivered; otherwise 'failed'
 *  (per-channel rows remain the source of truth for which channel failed). */
export function computePostStatus(totalRequested: number, sentCount: number): "sent" | "failed" {
  return totalRequested > 0 && sentCount >= totalRequested ? "sent" : "failed";
}
