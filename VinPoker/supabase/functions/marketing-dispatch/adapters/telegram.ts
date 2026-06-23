// marketing-dispatch — Telegram channel adapter.
// Reuses the same per-attempt timeout + exponential-backoff shape as process-pre-announce-jobs.
// Sends the post body to the club's Telegram chat (club_settings.telegram_chat_id) using the
// global TELEGRAM_BOT_TOKEN. Returns a typed result; the caller records it via
// marketing_record_channel_result.

export interface AdapterResult {
  ok: boolean;
  externalId?: string | null; // telegram message_id
  error?: string;
  retryable?: boolean;
}

const MAX_HTTP_RETRIES = 3;
const PER_ATTEMPT_TIMEOUT_MS = 5000;

export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<AdapterResult> {
  if (!botToken) return { ok: false, error: "no_telegram_bot_token", retryable: false };
  if (!chatId) return { ok: false, error: "no_chat_id", retryable: false };

  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

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

      if (res.ok) {
        let externalId: string | null = null;
        try {
          const data = await res.json();
          externalId = data?.result?.message_id != null ? String(data.result.message_id) : null;
        } catch (_) {
          // delivered but body unparsable — still a success
        }
        return { ok: true, externalId };
      }

      const errText = await res.text();
      const errMsg = `HTTP ${res.status}: ${errText.substring(0, 200)}`;
      // 4xx = client error (bad chat id / blocked) — not transient.
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

/** Compose the Telegram message text from a post (title + body + hashtags). HTML-escaped. */
export function composeTelegramText(
  title: string | null,
  body: string,
  hashtags: string[] | null,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  if (title && title.trim()) parts.push(`<b>${esc(title.trim())}</b>`);
  parts.push(esc(body));
  if (hashtags && hashtags.length) parts.push(hashtags.map((h) => esc(h.startsWith("#") ? h : `#${h}`)).join(" "));
  return parts.join("\n\n");
}
