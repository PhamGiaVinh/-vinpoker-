/**
 * Build identity is intentionally separate from the human-readable build
 * timestamp. Forecast provenance must point at the reviewed source revision,
 * and a missing revision must remain visibly ineligible.
 */
const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;

export interface BuildGitShaSources {
  readonly vercelGitCommitSha?: unknown;
  readonly githubSha?: unknown;
  readonly ciCommitSha?: unknown;
  readonly localGitSha?: unknown;
}

export function normalizeBuildGitSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return null;
  return GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

/** Resolve only from named, reviewable source slots. Order is part of the contract. */
export function resolveBuildGitShaFromSources(sources: BuildGitShaSources): string | null {
  return (
    normalizeBuildGitSha(sources.vercelGitCommitSha) ??
    normalizeBuildGitSha(sources.githubSha) ??
    normalizeBuildGitSha(sources.ciCommitSha) ??
    normalizeBuildGitSha(sources.localGitSha)
  );
}

/** The Vite compile-time seam. No timestamp or ambient runtime value is accepted. */
export function getBuildGitSha(): string | null {
  return normalizeBuildGitSha(
    typeof __APP_GIT_COMMIT_SHA__ === "undefined" ? null : __APP_GIT_COMMIT_SHA__,
  );
}
