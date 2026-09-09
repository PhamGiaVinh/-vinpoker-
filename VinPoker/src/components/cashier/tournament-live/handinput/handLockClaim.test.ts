import { describe, expect, it } from "vitest";

import { resolveHandLockActorId, resolveHandLockClaim } from "./handLockClaim";

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

describe("resolveHandLockActorId", () => {
  it("uses the hydrated actor without reloading auth", async () => {
    let loads = 0;
    const actorId = await resolveHandLockActorId("cached-actor", async () => {
      loads += 1;
      return "loaded-actor";
    });

    expect(actorId).toBe("cached-actor");
    expect(loads).toBe(0);
  });

  it("loads the authenticated actor during the initial hydration race", async () => {
    expect(await resolveHandLockActorId(null, async () => "loaded-actor")).toBe("loaded-actor");
    expect(await resolveHandLockActorId(null, async () => null)).toBeNull();
  });
});
