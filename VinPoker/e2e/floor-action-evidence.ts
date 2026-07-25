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

export type ObservedFloorControl = {
  label: string;
  enabled: boolean;
};

export type FloorControlInventory = {
  matches: Array<{
    entry: FloorButtonCoverageEntry;
    observed: string;
    enabled: boolean;
  }>;
  unclassified: string[];
  stateMismatches: string[];
  enabledCount: number;
  visibleCount: number;
  fingerprint: string;
  ready: boolean;
};

export type StableInventoryProgress = {
  fingerprint: string | null;
  consecutive: number;
  accepted: boolean;
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

export function evaluateControlInventory(
  entries: readonly FloorButtonCoverageEntry[],
  observedControls: readonly ObservedFloorControl[],
  options: { exactlyOnceManifestIds?: readonly string[] } = {},
): FloorControlInventory {
  const matches: FloorControlInventory["matches"] = [];
  const unclassified: string[] = [];
  const stateMismatches: string[] = [];
  let enabledCount = 0;

  for (const control of observedControls) {
    if (control.enabled) enabledCount += 1;
    const observed = normaliseManifestLabel(control.label) || "<unlabelled-enabled-control>";
    const entry = rankedManifestEntries(entries, observed)[0];
    if (!entry) {
      if (control.enabled) unclassified.push(observed);
      continue;
    }
    matches.push({ entry, observed, enabled: control.enabled });
    if (control.enabled && ["disabled", "hidden"].includes(entry.expectedState)) {
      stateMismatches.push(`${entry.id}:expected_${entry.expectedState}_observed_enabled`);
    }
    if (!control.enabled && ["enabled", "navigation-only"].includes(entry.expectedState)) {
      stateMismatches.push(`${entry.id}:expected_${entry.expectedState}_observed_disabled`);
    }
  }

  for (const manifestId of options.exactlyOnceManifestIds ?? []) {
    const observedCount = matches.filter(({ entry }) => entry.id === manifestId).length;
    if (observedCount !== 1) {
      stateMismatches.push(`${manifestId}:expected_once_observed_${observedCount}`);
    }
  }

  const fingerprint = JSON.stringify(observedControls.map(({ label, enabled }) => [
    normaliseManifestLabel(label) || "<unlabelled-enabled-control>",
    enabled,
  ]));
  const ready = enabledCount > 0 && unclassified.length === 0 && stateMismatches.length === 0;
  return {
    matches,
    unclassified,
    stateMismatches,
    enabledCount,
    visibleCount: observedControls.length,
    fingerprint,
    ready,
  };
}

export function advanceStableInventory(
  previous: StableInventoryProgress | undefined,
  inventory: FloorControlInventory,
  requiredStableSnapshots = 2,
): StableInventoryProgress {
  if (!Number.isInteger(requiredStableSnapshots) || requiredStableSnapshots < 1) {
    throw new Error("requiredStableSnapshots must be a positive integer");
  }
  if (!inventory.ready) {
    return { fingerprint: null, consecutive: 0, accepted: false };
  }
  const consecutive = previous?.fingerprint === inventory.fingerprint
    ? previous.consecutive + 1
    : 1;
  return {
    fingerprint: inventory.fingerprint,
    consecutive,
    accepted: consecutive >= requiredStableSnapshots,
  };
}

export function advanceFailClosedInventory(
  previous: StableInventoryProgress | undefined,
  inventory: FloorControlInventory,
  options: {
    requiredStableSnapshots?: number;
    retryableStateMismatches?: readonly string[];
  } = {},
): StableInventoryProgress {
  const retryableStateMismatches = options.retryableStateMismatches ?? [];
  const retryable = !inventory.ready
    && inventory.unclassified.length === 0
    && inventory.stateMismatches.length === 1
    && retryableStateMismatches.includes(inventory.stateMismatches[0]);

  if (!inventory.ready && !retryable) {
    throw new Error([
      "floor_control_inventory_violation",
      `visible=${inventory.visibleCount}`,
      `enabled=${inventory.enabledCount}`,
      `unclassified=${inventory.unclassified.length}`,
      `mismatches=${inventory.stateMismatches.join(",") || "none"}`,
    ].join(" "));
  }

  return advanceStableInventory(
    previous,
    inventory,
    options.requiredStableSnapshots,
  );
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
