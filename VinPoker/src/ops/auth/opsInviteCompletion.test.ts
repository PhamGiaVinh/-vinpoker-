import { describe, expect, it } from "vitest";
import {
  callbackDestination,
  parseOpsCallback,
  stripOpsAuthArtifacts,
} from "@/ops/auth/opsInviteCompletion";

describe("Ops invitation completion", () => {
  it("routes token-hash invitations to the mandatory password screen", () => {
    const intent = parseOpsCallback(
      "https://ops.example.com/ops/auth/callback?token_hash=opaque&type=invite",
    );
    expect(intent.kind).toBe("token_hash");
    expect(callbackDestination(intent)).toBe(
      "/ops/account?mode=reset-password&source=invite",
    );
  });

  it("accepts an implicit invite fragment and removes all callback artifacts", () => {
    const href =
      "https://ops.example.com/ops/auth/callback#access_token=opaque&refresh_token=opaque&type=invite";
    expect(parseOpsCallback(href).kind).toBe("implicit");
    expect(stripOpsAuthArtifacts(href)).toBe("/ops/auth/callback");
  });

  it("keeps PKCE and recovery flows distinct", () => {
    expect(
      parseOpsCallback(
        "https://ops.example.com/ops/auth/callback?code=opaque&next=%2Fops%2Ffloor",
      ).kind,
    ).toBe("pkce");
    const recovery = parseOpsCallback(
      "https://ops.example.com/ops/auth/callback?token_hash=opaque&type=recovery",
    );
    expect(callbackDestination(recovery)).toBe(
      "/ops/account?mode=reset-password",
    );
  });

  it("rejects malformed callback fragments instead of using an ambient session", () => {
    expect(
      parseOpsCallback(
        "https://ops.example.com/ops/auth/callback#error_code=otp_expired",
      ).kind,
    ).toBe("invalid");
  });
});
