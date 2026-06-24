// marketing-dispatch — Facebook Page channel adapter (Graph API).
// Posts to a club's Facebook Page using a Page Access Token (pages_manage_posts). Text posts go to
// /{page-id}/feed; if the post has an image, it goes to /{page-id}/photos with the text as caption.
// Same per-attempt timeout + backoff shape as the Telegram adapter. The token is supplied by the
// caller (resolved from Vault via marketing_get_facebook_dispatch) — never hardcoded/logged.

export interface AdapterResult {
  ok: boolean;
  externalId?: string | null;
  error?: string;
  retryable?: boolean;
}

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_HTTP_RETRIES = 3;
const PER_ATTEMPT_TIMEOUT_MS = 8000;

export async function sendFacebook(
  pageToken: string,
  pageId: string,
  text: string,
  mediaUrl?: string | null,
): Promise<AdapterResult> {
  if (!pageToken) return { ok: false, error: "no_page_token", retryable: false };
  if (!pageId) return { ok: false, error: "no_page_id", retryable: false };

  const endpoint = mediaUrl ? `${GRAPH}/${pageId}/photos` : `${GRAPH}/${pageId}/feed`;

  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const form = new URLSearchParams();
      form.set("access_token", pageToken);
      if (mediaUrl) { form.set("url", mediaUrl); if (text) form.set("caption", text); }
      else { form.set("message", text); }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({} as any));
      if (res.ok) {
        const externalId = data?.post_id ?? data?.id ?? null;
        return { ok: true, externalId: externalId != null ? String(externalId) : null };
      }
      // Graph errors: {error:{message,code,type}}. 4xx (bad token/perm/page) = not transient.
      const msg = `HTTP ${res.status}: ${(data?.error?.message ?? JSON.stringify(data)).toString().substring(0, 200)}`;
      if (res.status >= 400 && res.status < 500) return { ok: false, error: msg, retryable: false };
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: msg, retryable: true };
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: `timeout/exception: ${m}`, retryable: true };
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, error: "exhausted_retries", retryable: true };
}

/** Plain-text Facebook post body (title + body + hashtags). FB feed messages are plain text — no
 *  HTML escaping (unlike Telegram's HTML parse_mode). */
export function composeFacebookText(
  title: string | null,
  body: string,
  hashtags: string[] | null,
): string {
  const parts: string[] = [];
  if (title && title.trim()) parts.push(title.trim());
  parts.push(body);
  if (hashtags && hashtags.length) parts.push(hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "));
  return parts.join("\n\n");
}
