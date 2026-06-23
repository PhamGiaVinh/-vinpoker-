/**
 * marketing-dispatch (MKT-3)
 *
 * Drains due marketing posts and delivers them to their channels. Invoked every minute by
 * pg_cron (20261101000003_schedule_marketing_dispatch.sql), Bearer-authed.
 *
 * Flow per tick:
 *   1. Claim due posts via RPC marketing_claim_due_posts (scheduled & due → processing,
 *      FOR UPDATE SKIP LOCKED) — exactly-once even with overlapping ticks (P0-5).
 *   2. For each post, for each requested channel NOT already 'sent' (skip-if-sent + the
 *      UNIQUE(post_id, channel) constraint = the exactly-once guard):
 *        - telegram → resolve club_settings.telegram_chat_id, send via the Telegram adapter;
 *        - facebook/zalo → NO adapter in P0 (Telegram-only). Recorded as 'failed' with an
 *          explicit error, never silently "skipped".
 *      Each outcome is written via marketing_record_channel_result.
 *   3. marketing_finalize_post sets the post to 'sent' (all channels delivered) or 'failed'.
 *
 * SOURCE-ONLY: deployed via the Edge deploy workflow on owner approval. Until the MKT-2
 * migrations are applied + the cron is scheduled, this fn simply finds no due posts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  channelsNeedingSend,
  IMPLEMENTED_CHANNELS,
  parseChannels,
} from "./dispatchLogic.ts";
import { composeTelegramText, sendTelegram } from "./adapters/telegram.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_POSTS_PER_TICK = 20;
const TICK_TIMEOUT_MS = 25000;

interface DispatchResult {
  outcome: "processed" | "no_posts" | "error";
  claimed?: number;
  posts_sent?: number;
  posts_failed?: number;
  channels_sent?: number;
  channels_failed?: number;
  duration_ms: number;
  errors?: string[];
  error?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startTime = Date.now();

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !service) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    const admin = createClient(url, service);
    const body = await req.json().catch(() => ({}));
    const botToken = body.bot_token ?? Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

    const tick = processTick(admin, botToken, startTime);
    const timeout = new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve(json({
            outcome: "processed",
            duration_ms: Date.now() - startTime,
            errors: ["tick_timeout"],
          } as DispatchResult)),
        TICK_TIMEOUT_MS,
      )
    );
    return await Promise.race([tick, timeout]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[marketing-dispatch] unhandled error:", msg);
    return json({ outcome: "error", error: msg, duration_ms: Date.now() - startTime } as DispatchResult, 500);
  }
});

async function processTick(admin: any, botToken: string, startTime: number): Promise<Response> {
  const errors: string[] = [];
  let postsSent = 0, postsFailed = 0, channelsSent = 0, channelsFailed = 0;

  // ── Step 1: claim due posts (scheduled → processing, exactly once) ──
  const { data: claimed, error: claimErr } = await admin.rpc("marketing_claim_due_posts", {
    p_limit: MAX_POSTS_PER_TICK,
  });
  if (claimErr) {
    return json({
      outcome: "error", error: `claim: ${claimErr.message}`, duration_ms: Date.now() - startTime,
    } as DispatchResult, 500);
  }
  const posts = (claimed ?? []) as any[];
  if (posts.length === 0) {
    return json({ outcome: "no_posts", claimed: 0, duration_ms: Date.now() - startTime } as DispatchResult);
  }

  // ── Step 2: deliver each post's channels ──
  for (const post of posts) {
    const requested = parseChannels(post.channels);

    // skip-if-sent: read which channels already delivered (re-run safety).
    const { data: existing } = await admin
      .from("post_channel_status")
      .select("channel,status")
      .eq("post_id", post.id);
    const alreadySent = (existing ?? []).filter((r: any) => r.status === "sent").map((r: any) => r.channel);
    const toSend = channelsNeedingSend(requested, alreadySent);

    // Resolve the club's Telegram chat once (P0 routing).
    let tgChat: string | null = null;
    if (toSend.includes("telegram")) {
      const { data: cs } = await admin
        .from("club_settings")
        .select("telegram_chat_id")
        .eq("club_id", post.club_id)
        .maybeSingle();
      tgChat = cs?.telegram_chat_id ?? null;
    }

    for (const channel of toSend) {
      if (channel === "telegram") {
        if (!tgChat) {
          await record(admin, post.id, "telegram", "failed", null, "no_chat_id");
          channelsFailed++;
          errors.push(`post ${post.id}: telegram no_chat_id`);
          continue;
        }
        const text = composeTelegramText(post.title ?? null, post.body, post.hashtags ?? []);
        const res = await sendTelegram(botToken, tgChat, text);
        if (res.ok) {
          await record(admin, post.id, "telegram", "sent", res.externalId ?? null, null);
          channelsSent++;
        } else {
          await record(admin, post.id, "telegram", "failed", null, res.error ?? "send_failed");
          channelsFailed++;
          errors.push(`post ${post.id}: telegram ${res.error ?? "send_failed"}`);
        }
      } else if (!IMPLEMENTED_CHANNELS.has(channel)) {
        // P0 = Telegram-only. FB/Zalo have no adapter yet — record an explicit failure (never a
        // silent "skipped" that could read as delivered). The schedule RPC already prevents this
        // for unconfigured channels; this is defence-in-depth.
        await record(admin, post.id, channel, "failed", null, "CHANNEL_ADAPTER_NOT_IMPLEMENTED");
        channelsFailed++;
      }
    }

    // ── Step 3: finalize the post from its per-channel rows ──
    const { data: fin } = await admin.rpc("marketing_finalize_post", { p_post_id: post.id });
    const status = fin?.post_status as string | undefined;
    if (status === "sent") postsSent++; else postsFailed++;
  }

  return json({
    outcome: "processed",
    claimed: posts.length,
    posts_sent: postsSent,
    posts_failed: postsFailed,
    channels_sent: channelsSent,
    channels_failed: channelsFailed,
    duration_ms: Date.now() - startTime,
    errors: errors.slice(0, 5),
  } as DispatchResult);
}

async function record(
  admin: any,
  postId: string,
  channel: string,
  status: "sent" | "failed" | "skipped",
  externalId: string | null,
  error: string | null,
): Promise<void> {
  const { error: rpcErr } = await admin.rpc("marketing_record_channel_result", {
    p_post_id: postId,
    p_channel: channel,
    p_status: status,
    p_external_id: externalId,
    p_error: error,
  });
  if (rpcErr) console.warn(`[marketing-dispatch] record ${channel} for ${postId} failed:`, rpcErr.message);
}
