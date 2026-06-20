// B1.2 — bulk-path idempotency wrapper for edge functions.
// Contract: docs/dealer-swing/B1_BULK_IDEMPOTENCY_DESIGN.md. Backed by the B1.1 RPCs
// idem_begin / idem_complete (+ edge_idempotency_keys store).
//
// Wraps an existing Response-returning handler with NO inner rewrite: pass the handler as a
// thunk; this claims the client-supplied key first, then runs / replays / rejects:
//   • no key                       → just runs the handler (no dedup).
//   • RPC not applied yet / errors → degrades to running the handler (zero regression pre-apply).
//   • claimed                      → run; on 2xx cache the body, else release the claim.
//   • already completed            → replay the cached body (idempotent retry).
//   • in progress (concurrent dup) → 409 (prevents the double effect / race).
//   • fingerprint mismatch         → 422 (same key reused with a different payload).

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Stable canonical JSON: sort object keys + sort primitive arrays so order never changes the hash. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) {
    const arr = v.map(canonical);
    if (arr.every((x) => x === null || typeof x !== "object")) {
      return [...arr].sort((a, b) => String(a).localeCompare(String(b)));
    }
    return arr;
  }
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return v;
}

export async function computeFingerprint(payload: unknown): Promise<string> {
  const json = JSON.stringify(canonical(payload));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function releaseClaim(admin: Admin, key: string): Promise<void> {
  try { await admin.from("edge_idempotency_keys").delete().eq("key", key); } catch { /* best-effort */ }
}

export interface IdempotencyParams {
  key: string | null;
  scope: string;
  clubId: string | null;
  actorId: string | null;
  /** Normalized request payload — hashed into the safety fingerprint. */
  fingerprint: unknown;
  /** Build a Response for cached/rejection bodies (each fn supplies its own CORS json builder). */
  json: (body: unknown, status: number) => Response;
  /** The real handler. Runs once (on claim); skipped entirely on replay/409/422. */
  run: () => Promise<Response>;
  ttlSeconds?: number;
}

export async function idempotentResponse(admin: Admin, p: IdempotencyParams): Promise<Response> {
  if (!p.key) return await p.run();

  // deno-lint-ignore no-explicit-any
  let begin: any = null;
  try {
    const fp = await computeFingerprint(p.fingerprint);
    const { data, error } = await admin.rpc("idem_begin", {
      p_key: p.key, p_scope: p.scope, p_club_id: p.clubId, p_actor_id: p.actorId,
      p_fingerprint: fp, p_ttl_seconds: p.ttlSeconds ?? 86400,
    });
    if (!error) begin = data;
  } catch { /* RPC absent / transient → degrade below */ }

  if (!begin) return await p.run(); // foundation not applied yet → behave as today

  if (!begin.claimed) {
    if (begin.fingerprint_match === false) {
      return p.json({ error: "Idempotency key reused with a different request" }, 422);
    }
    if (begin.status === "completed") {
      return p.json(begin.response ?? {}, 200);
    }
    return p.json({ error: "Yêu cầu đang được xử lý, vui lòng thử lại" }, 409);
  }

  let res: Response;
  try {
    res = await p.run();
  } catch (e) {
    await releaseClaim(admin, p.key); // let a legitimate retry through
    throw e;
  }

  if (res.status >= 200 && res.status < 300) {
    try {
      const body = await res.clone().json();
      await admin.rpc("idem_complete", { p_key: p.key, p_response: body });
    } catch { /* caching is best-effort; the real response already succeeded */ }
  } else {
    await releaseClaim(admin, p.key); // non-success → not cached; client may retry
  }
  return res;
}
