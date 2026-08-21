import { describe, expect, it } from "vitest";

import { resolveHandLockClaim } from "./handLockClaim";

describe("resolveHandLockClaim", () => {
  const actorId = "11111111-1111-4111-8111-111111111111";

  it("only enables the writer after the server confirms the authenticated owner", () => {
    expect(resolveHandLockClaim(
      { status: "success", locked_by: actorId },
      null,
      actorId,
    )).toEqual({ ok: true, code: "ok" });
  });

  it("treats JSONB policy denials and incomplete success envelopes as fail-closed", () => {
    expect(resolveHandLockClaim(
      { error: "tracker_lock_owned_by_another" },
      null,
      actorId,
    )).toEqual({ ok: false, code: "tracker_lock_owned_by_another" });
    expect(resolveHandLockClaim({ status: "success" }, null, actorId)).toEqual({
      ok: false,
      code: "lock_claim_unconfirmed",
    });
    expect(resolveHandLockClaim(null, new Error("offline"), actorId)).toEqual({
      ok: false,
      code: "lock_claim_transport_failed",
    });
  });
});
