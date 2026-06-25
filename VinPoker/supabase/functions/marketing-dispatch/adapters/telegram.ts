// marketing-dispatch — Telegram channel adapter.
// Text (sendMessage), single photo (sendPhoto), or album (sendMediaGroup, 2-10). Same per-attempt
// timeout + exponential-backoff for every call. The caller (index.ts) decides routing by image
// count and handles caption overflow. Returns a typed result; recorded via marketing_record_channel_result.

export interface AdapterResult {
  ok: boolean;
  externalId?: string | null; // telegram message_id (first message for an album)
  error?: string;
  retryable?: boolean;
}

const MAX_HTTP_RETRIES = 3;
const PER_ATTEMPT_TIMEOUT_MS = 8000;
export const TG_CAPTION_MAX = 1024; // Telegram caption limit (sendMessage text limit is 4096)

// Shared call with retry/backoff. `arrayResult` = true for sendMediaGroup (result is Message[]).
async function tgCall(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  arrayResult = false,
): Promise<AdapterResult> {
  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
      const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        let externalId: string | null = null;
        try {
          const data = await res.json();
          const r = data?.result;
          const msg = arrayResult ? (Array.isArray(r) ? r[0] : null) : r;
          externalId = msg?.message_id != null ? String(msg.message_id) : null;
        } catch (_) { /* delivered but body unparsable — still a success */ }
        return { ok: true, externalId };
      }

      const errText = await res.text();
      const errMsg = `HTTP ${res.status}: ${errText.substring(0, 200)}`;
      if (res.status >= 400 && res.status < 500) return { ok: false, error: errMsg, retryable: false };
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: errMsg, retryable: true };
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: `timeout/exception: ${msg}`, retryable: true };
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, error: "exhausted_retries", retryable: true };
}

export async function sendTelegram(botToken: string, chatId: string, text: string): Promise<AdapterResult> {
  if (!botToken) return { ok: false, error: "no_telegram_bot_token", retryable: false };
  if (!chatId) return { ok: false, error: "no_chat_id", retryable: false };
  return tgCall(botToken, "sendMessage", {
    chat_id: String(chatId), text, parse_mode: "HTML", disable_web_page_preview: true,
  });
}

export async function sendTelegramPhoto(
  botToken: string, chatId: string, photoUrl: string, caption: string,
): Promise<AdapterResult> {
  if (!botToken) return { ok: false, error: "no_telegram_bot_token", retryable: false };
  if (!chatId) return { ok: false, error: "no_chat_id", retryable: false };
  if (!photoUrl) return { ok: false, error: "no_photo", retryable: false };
  const payload: Record<string, unknown> = { chat_id: String(chatId), photo: photoUrl };
  if (caption) { payload.caption = caption; payload.parse_mode = "HTML"; }
  return tgCall(botToken, "sendPhoto", payload);
}

// 2-10 photos as one album; caption + parse_mode on the FIRST item only (Telegram rule).
export async function sendTelegramMediaGroup(
  botToken: string, chatId: string, photoUrls: string[], caption: string,
): Promise<AdapterResult> {
  if (!botToken) return { ok: false, error: "no_telegram_bot_token", retryable: false };
  if (!chatId) return { ok: false, error: "no_chat_id", retryable: false };
  const urls = photoUrls.slice(0, 10);
  if (urls.length < 2) return { ok: false, error: "media_group_needs_2_to_10", retryable: false };
  const media = urls.map((u, i) =>
    i === 0 && caption
      ? { type: "photo", media: u, caption, parse_mode: "HTML" }
      : { type: "photo", media: u });
  // If a single URL in the group is bad, Telegram fails the WHOLE call — recorded as failed by the
  // caller (no silent partial send). P1-1.
  return tgCall(botToken, "sendMediaGroup", { chat_id: String(chatId), media }, true);
}

/** Full HTML post text (title + body + hashtags), escaped. sendMessage limit ~4096. */
export function composeTelegramText(title: string | null, body: string, hashtags: string[] | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  if (title && title.trim()) parts.push(`<b>${esc(title.trim())}</b>`);
  parts.push(esc(body));
  if (hashtags && hashtags.length) parts.push(hashtags.map((h) => esc(h.startsWith("#") ? h : `#${h}`)).join(" "));
  return parts.join("\n\n");
}

/** Safe caption ≤ maxLen for sendPhoto/sendMediaGroup. Keeps the whole <b>title</b> tag (never cut
 *  mid-tag) + a truncated escaped body. Returns "" if even the title doesn't fit (caller then sends
 *  the photo caption-less + a full-text follow-up message — P2-6). */
export function composeTelegramCaption(
  title: string | null, body: string, maxLen = TG_CAPTION_MAX,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = title && title.trim() ? `<b>${esc(title.trim())}</b>\n\n` : "";
  if (head.length > maxLen) return "";
  const bodyEsc = esc(body);
  if (head.length + bodyEsc.length <= maxLen) return head + bodyEsc;
  const room = maxLen - head.length - 1; // 1 char for the ellipsis
  if (room <= 0) return head.trimEnd();
  return head + bodyEsc.slice(0, room) + "…";
}
