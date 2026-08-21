export type HandLockClaimResolution = {
  ok: boolean;
  code: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// A successful transport response is not enough: PostgREST RPC denials are JSONB.
// The writer stays fail-closed until the server proves that this user owns the lock.
export function resolveHandLockClaim(
  data: unknown,
  error: unknown,
  actorId: string,
): HandLockClaimResolution {
  if (error) return { ok: false, code: "lock_claim_transport_failed" };

  const payload = asRecord(data);
  if (typeof payload?.error === "string") return { ok: false, code: payload.error };
  if (payload?.status !== "success" || payload.locked_by !== actorId) {
    return { ok: false, code: "lock_claim_unconfirmed" };
  }
  return { ok: true, code: "ok" };
}
