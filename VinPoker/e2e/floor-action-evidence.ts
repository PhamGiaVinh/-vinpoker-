import type {
  FloorAuditResult,
  FloorAuditViewport,
  FloorButtonCoverageEntry,
} from "./floor-button-coverage.manifest";

export type FloorControlEvidence = {
  manifestId: string;
  status: FloorAuditResult;
  phase: "baseline" | "discovery";
  route: string;
  role: FloorButtonCoverageEntry["role"];
  viewport: FloorAuditViewport;
  stateMismatch: boolean;
};

function normaliseManifestLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
}

export function rankedManifestEntries(
  entries: readonly FloorButtonCoverageEntry[],
  observedLabel: string,
): FloorButtonCoverageEntry[] {
  const observed = normaliseManifestLabel(observedLabel);
  return entries
    .map((entry, index) => {
      const expected = normaliseManifestLabel(entry.testId ?? entry.label);
      const exact = observed === expected;
      const pattern = entry.labelPattern ? new RegExp(entry.labelPattern, "iu").test(observed) : false;
      const prefix = expected.length > 0 && observed.startsWith(`${expected} `);
      return { entry, index, expectedLength: expected.length, rank: exact ? 3 : pattern ? 2 : prefix ? 1 : 0 };
    })
    .filter((candidate) => candidate.rank > 0)
    .sort((left, right) => (
      right.rank - left.rank
      || right.expectedLength - left.expectedLength
      || left.index - right.index
    ))
    .map((candidate) => candidate.entry);
}

function policyStatus(entry: FloorButtonCoverageEntry): FloorAuditResult | null {
  if (!entry.exclusionReason) return null;
  if (
    entry.expectedState === "disabled"
    || entry.expectedState === "hidden"
    || entry.exclusionReason.startsWith("EXPECTED_DISABLED")
  ) return "EXPECTED_DISABLED";
  return "EXCLUDED_WITH_REASON";
}

export function baselineEvidence(entry: FloorButtonCoverageEntry): FloorControlEvidence {
  const status = policyStatus(entry) ?? (
    entry.expectedState === "disabled" || entry.expectedState === "hidden"
      ? "EXPECTED_DISABLED"
      : "BLOCKED"
  );
  return {
    manifestId: entry.id,
    status,
    phase: "baseline",
    route: entry.route,
    role: entry.role,
    viewport: entry.viewport,
    stateMismatch: false,
  };
}

export function discoveryEvidence(
  entry: FloorButtonCoverageEntry,
  viewport: Exclude<FloorAuditViewport, "all">,
  enabled: boolean,
): FloorControlEvidence {
  const stateMismatch = enabled
    ? entry.expectedState === "disabled" || entry.expectedState === "hidden"
    : entry.expectedState === "enabled" || entry.expectedState === "navigation-only";
  const status = stateMismatch
    ? "BLOCKED"
    : policyStatus(entry) ?? (
      entry.expectedState === "navigation-only"
        ? "NAVIGATION_ONLY"
        : entry.expectedState === "disabled" || entry.expectedState === "hidden"
          ? "EXPECTED_DISABLED"
          : "BLOCKED"
    );
  return {
    manifestId: entry.id,
    status,
    phase: "discovery",
    route: entry.route,
    role: entry.role,
    viewport,
    stateMismatch,
  };
}
