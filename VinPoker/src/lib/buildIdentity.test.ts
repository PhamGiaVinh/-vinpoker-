import { describe, expect, it } from "vitest";
import { normalizeBuildGitSha, resolveBuildGitShaFromSources } from "./buildIdentity";

describe("trusted build git identity", () => {
  const SHA = "A".repeat(40);

  it("normalizes an accepted SHA and rejects timestamp-like values", () => {
    expect(normalizeBuildGitSha(` ${SHA} `)).toBe("a".repeat(40));
    expect(normalizeBuildGitSha("1722444000000")).toBeNull();
    expect(normalizeBuildGitSha("unknown")).toBeNull();
    expect(normalizeBuildGitSha("not-a-sha")).toBeNull();
  });

  it("uses the trusted source order and falls through malformed values", () => {
    expect(resolveBuildGitShaFromSources({ vercelGitCommitSha: SHA, githubSha: "b".repeat(40), localGitSha: "c".repeat(40) })).toBe("a".repeat(40));
    expect(resolveBuildGitShaFromSources({ vercelGitCommitSha: "bad", githubSha: "B".repeat(40), localGitSha: "c".repeat(40) })).toBe("b".repeat(40));
  });

  it("returns null when no trusted source is available", () => {
    expect(resolveBuildGitShaFromSources({})).toBeNull();
    expect(resolveBuildGitShaFromSources({ vercelGitCommitSha: "unknown", githubSha: 123, ciCommitSha: "2026-08-08" })).toBeNull();
  });
});
