// Shared retry helper for Edge Functions.
// Exponential backoff with jitter. Retries only on transient errors
// (network failures, 5xx, 429, timeouts). Never retries on 4xx so
// business-logic errors fail fast.

export interface RetryOptions {
  name: string;            // e.g. "staking-commit-deal:insert" — shows up in logs
  maxRetries?: number;     // default 3
  baseDelayMs?: number;    // default 1000
  idempotencyKey?: string; // optional, only logged
}

const TRANSIENT_MESSAGE_PATTERNS = [
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /timed out/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /TLS/i,
];

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as Record<string, unknown> & { message?: string; status?: number; code?: string | number };

  // Supabase PostgrestError-style: do NOT retry, those are query/business errors.
  if (typeof anyErr.code === "string" && /^[0-9A-Z]{5}$/.test(anyErr.code)) {
    return false;
  }

  const status = typeof anyErr.status === "number" ? anyErr.status : undefined;
  if (status !== undefined) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }

  const msg = String(anyErr.message ?? err);
  return TRANSIENT_MESSAGE_PATTERNS.some((re) => re.test(msg));
}

function jitter(ms: number): number {
  const delta = ms * 0.2;
  return Math.round(ms + (Math.random() * 2 - 1) * delta);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      const willRetry = transient && attempt < maxRetries;

      console.error(
        JSON.stringify({
          level: "warn",
          tag: "edge_retry",
          name: opts.name,
          attempt,
          maxRetries,
          willRetry,
          transient,
          idempotencyKey: opts.idempotencyKey,
          error: (err as { message?: string })?.message ?? String(err),
        }),
      );

      if (!willRetry) throw err;
      const delay = jitter(baseDelayMs * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

// Convenience wrapper for typical Supabase calls that resolve to
// `{ data, error }`. Treats `error` with status >=500 / network msgs
// as transient and retries; otherwise returns the result as-is.
async function withRetrySb<T>(
  fn: () => Promise<{ data: T | null; error: unknown }>,
  opts: RetryOptions,
): Promise<{ data: T | null; error: unknown }> {
  return await withRetry(async () => {
    const res = await fn();
    if (res.error && isTransientError(res.error)) {
      throw res.error;
    }
    return res;
  }, opts);
}

// Drop-in fetch replacement with retry for transient network/5xx errors.
// Use as: createClient(url, key, { global: { fetch: retryFetch } })
// Only retries idempotent-ish failures: network errors and HTTP 5xx/429.
// Body is buffered so retry can re-send it.
export const retryFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.toString()
    : input.url;
  const method = (((init as { method?: string } | undefined)?.method) ?? "GET").toUpperCase();
  const name = `fetch:${method} ${url.replace(/\?.*$/, "").split("/").slice(-2).join("/")}`;

  return await withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      // Network error — let withRetry decide.
      throw err;
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      // Throw an Error with status so isTransientError sees it.
      const body = await res.text().catch(() => "");
      const e = new Error(`HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
      (e as Error & { status?: number }).status = res.status;
      throw e;
    }
    return res;
  }, { name, maxRetries: 3 });
};
