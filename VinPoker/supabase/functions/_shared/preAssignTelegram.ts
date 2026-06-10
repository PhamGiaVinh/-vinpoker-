import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface DealerMention {
  full_name: string;
  telegram_username?: string | null;
  telegram_user_id?: number | string | null;
}

export interface PreAssignMessageItem {
  tableName: string;
  zone: string | null;
  outName: string;
  outUsername: string | null;
  outTelegramUserId?: number | string | null;
  inName: string;
  inUsername: string | null;
  inTelegramUserId?: number | string | null;
  swingAt: Date;
  minutesLeft: number;
}

export interface PreAssignNotificationPayload extends PreAssignMessageItem {
  clubId: string;
  tableId: string;
  assignmentId: string;
  attendanceId: string;
  outAttendanceId?: string | null;
  restDeficitMin?: number;
  chatId: string;
}

export interface PreAssignSendResult {
  delivered: boolean;
  queued: boolean;
  directError?: string;
  fallbackError?: string;
}

const DIRECT_TIMEOUT_MS = 5000;
const DIRECT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mentionDealer(dealer: {
  full_name: string;
  telegram_username?: string | null;
  telegram_user_id?: number | string | null;
}): string {
  if (dealer.telegram_username) {
    return `@${dealer.telegram_username}`;
  }

  const telegramUserId = dealer.telegram_user_id;
  if (telegramUserId !== null && telegramUserId !== undefined && String(telegramUserId).trim() !== "") {
    return `<a href="tg://user?id=${String(telegramUserId)}">${escapeHtml(dealer.full_name)}</a>`;
  }

  return escapeHtml(dealer.full_name);
}

function hhmm(date: Date): string {
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export function formatPreAssignLine(item: PreAssignMessageItem): string {
  return `📋 Tiếp theo ${item.tableName}: ` +
    `${mentionDealer({ full_name: item.outName, telegram_username: item.outUsername, telegram_user_id: item.outTelegramUserId ?? null })} ra, ` +
    `${mentionDealer({ full_name: item.inName, telegram_username: item.inUsername, telegram_user_id: item.inTelegramUserId ?? null })} vào ` +
    `(${hhmm(item.swingAt)}, còn ${item.minutesLeft} phút)`;
}

export function formatPreAssignMessage(item: PreAssignMessageItem): string {
  const zoneLabel = item.zone ? ` - ${item.zone}` : "";
  return [
    `Có 1 cập nhật${zoneLabel}:`,
    ` ${formatPreAssignLine(item)}`,
  ].join("\n");
}

export function formatBatchPreAssignMessage(items: PreAssignMessageItem[]): string {
  if (items.length === 0) return "";

  const zones = [...new Set(items.map((item) => item.zone).filter((zone): zone is string => !!zone))];
  const zoneLabel = zones.length === 1 ? ` - ${zones[0]}` : "";
  const header = `Có ${items.length} cập nhật${zoneLabel}:`;
  const lines = items.map((item) => ` ${formatPreAssignLine(item)}`);
  return [header, ...lines].join("\n");
}

async function sendTelegramHtmlWithRetry(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= DIRECT_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) return { ok: true };

      const body = await res.text();
      const error = `HTTP ${res.status}: ${body.slice(0, 250)}`;
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, error };
      }

      if (attempt === DIRECT_MAX_RETRIES) {
        return { ok: false, error };
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err instanceof Error ? err.message : String(err);
      if (attempt === DIRECT_MAX_RETRIES) {
        return { ok: false, error: `timeout/exception: ${error}` };
      }
    }

    await sleep(200 * Math.pow(2, attempt - 1));
  }

  return { ok: false, error: "exhausted_retries" };
}

async function enqueuePreAnnounceFallback(
  admin: SupabaseClient,
  payload: PreAssignNotificationPayload,
): Promise<{ queued: boolean; duplicate: boolean; error?: string }> {
  const { error } = await admin.from("pre_announce_jobs").insert({
    club_id: payload.clubId,
    table_id: payload.tableId,
    assignment_id: payload.assignmentId,
    attendance_id: payload.attendanceId,
    out_attendance_id: payload.outAttendanceId ?? null,
    table_name: payload.tableName,
    zone: payload.zone,
    in_dealer_name: payload.inName,
    in_dealer_username: payload.inUsername,
    out_dealer_name: payload.outName,
    out_dealer_username: payload.outUsername,
    swing_at: payload.swingAt.toISOString(),
    minutes_left: payload.minutesLeft,
    rest_deficit_min: payload.restDeficitMin ?? 0,
    chat_id: payload.chatId,
    status: "pending",
    max_attempts: 3,
  });

  if (!error) {
    return { queued: true, duplicate: false };
  }

  if (error.code === "23505") {
    return { queued: true, duplicate: true };
  }

  return { queued: false, duplicate: false, error: error.message };
}

export async function sendPreAssignTelegramWithFallback(
  admin: SupabaseClient,
  payload: PreAssignNotificationPayload,
  botToken?: string | null,
  logPrefix = "[pre-assign]",
): Promise<PreAssignSendResult> {
  if (!payload.chatId) {
    return { delivered: false, queued: false, directError: "missing_chat_id" };
  }

  const message = formatPreAssignMessage(payload);
  let directError: string | undefined;

  if (botToken) {
    const direct = await sendTelegramHtmlWithRetry(botToken, payload.chatId, message);
    if (direct.ok) {
      return { delivered: true, queued: false };
    }
    directError = direct.error;
    console.warn(`${logPrefix} direct send failed for ${payload.tableName}: ${direct.error}`);
  } else {
    directError = "missing_bot_token";
    console.warn(`${logPrefix} missing bot token for ${payload.tableName}, using fallback queue`);
  }

  const fallback = await enqueuePreAnnounceFallback(admin, payload);
  if (fallback.queued) {
    if (fallback.duplicate) {
      console.log(`${logPrefix} fallback already queued for ${payload.tableName}`);
    } else {
      console.log(`${logPrefix} fallback queued for ${payload.tableName}`);
    }
    return {
      delivered: false,
      queued: true,
      directError,
      fallbackError: fallback.error,
    };
  }

  console.error(`${logPrefix} failed to queue fallback for ${payload.tableName}: ${fallback.error ?? "unknown"}`);
  return {
    delivered: false,
    queued: false,
    directError,
    fallbackError: fallback.error,
  };
}
