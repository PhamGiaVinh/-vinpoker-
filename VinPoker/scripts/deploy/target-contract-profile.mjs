import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectImportGraph } from "./verify-target-source.mjs";

export const LEGACY_PROFILE = "dealer_swing_legacy";
export const MASS_OPEN_PROFILE = "dealer_mass_open_v1";

const EDGE_EVIDENCE_ROOTS = [
  "VinPoker/supabase/functions/process-swing/index.ts",
  "VinPoker/supabase/functions/mass-assign/index.ts",
  "VinPoker/supabase/functions/checkout-dealer/index.ts",
];

const FRONTEND_EVIDENCE_FILES = [
  "VinPoker/src/components/cashier/DealerSwingTab.tsx",
  "VinPoker/src/lib/dealerMassOpen.ts",
];

function marker(files, sources, predicate) {
  return files.filter((file) => predicate(file, sources.get(file) ?? ""));
}

export function selectTargetContractProfile({ targetRoot }) {
  const files = new Set();
  for (const relativePath of EDGE_EVIDENCE_ROOTS) {
    const entrypoint = resolve(targetRoot, relativePath);
    if (!existsSync(entrypoint)) {
      const error = new Error(`UNKNOWN_TARGET_CONTRACT_PROFILE: missing evidence root ${relativePath}`);
      error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
      throw error;
    }
    for (const imported of inspectImportGraph(entrypoint, targetRoot)) files.add(imported);
  }
  for (const relativePath of FRONTEND_EVIDENCE_FILES) {
    if (existsSync(resolve(targetRoot, relativePath))) files.add(relativePath);
  }

  const orderedFiles = [...files].sort();
  const sources = new Map(orderedFiles.map((file) => [file, readFileSync(resolve(targetRoot, file), "utf8")]));
  const evidence = {
    fillEmptyTablesImport: marker(orderedFiles, sources, (file) => file.endsWith("/_shared/fillEmptyTables.ts")),
    fillOpenOperationImport: marker(orderedFiles, sources, (file) => file.endsWith("/_shared/fillOpenOperation.ts")),
    operationRelations: marker(orderedFiles, sources, (_file, source) =>
      source.includes("dealer_open_operations") && source.includes("dealer_open_operation_targets")),
    operationColumn: marker(orderedFiles, sources, (_file, source) => source.includes("dealer_open_operation_id")),
    rollout: marker(orderedFiles, sources, (_file, source) =>
      source.includes("dealer_mass_open_rollout") || source.includes("get_dealer_mass_open_rollout")),
    frontendOperationRpc: marker(orderedFiles, sources, (_file, source) =>
      source.includes("operator_open_dealer_tables") || source.includes("get_dealer_open_operation")),
  };

  const has = (key) => evidence[key].length > 0;
  const massOpenComplete = has("fillOpenOperationImport")
    && has("operationRelations")
    && has("operationColumn")
    && has("rollout")
    && has("frontendOperationRpc");
  const anyMassOpenMarker = has("fillOpenOperationImport")
    || has("operationRelations")
    || has("operationColumn")
    || has("rollout")
    || has("frontendOperationRpc");
  const legacyComplete = has("fillEmptyTablesImport") && !anyMassOpenMarker;

  let profile;
  if (massOpenComplete) profile = MASS_OPEN_PROFILE;
  else if (legacyComplete) profile = LEGACY_PROFILE;
  else {
    const error = new Error("UNKNOWN_TARGET_CONTRACT_PROFILE: target source markers are incomplete or contradictory");
    error.code = "UNKNOWN_TARGET_CONTRACT_PROFILE";
    error.evidence = evidence;
    throw error;
  }

  const hash = createHash("sha256");
  for (const file of orderedFiles) hash.update(`${file}\0${sources.get(file)}\0`);
  return {
    profile,
    sourceFingerprint: `sha256:${hash.digest("hex")}`,
    evidence,
    evidenceFiles: orderedFiles,
  };
}

export function assertTargetContractProfile({ targetRoot, expectedProfile }) {
  const selection = selectTargetContractProfile({ targetRoot });
  if (selection.profile !== expectedProfile) {
    const error = new Error(
      `TARGET_CONTRACT_PROFILE_MISMATCH: exact target selected ${selection.profile}, not ${expectedProfile}`,
    );
    error.code = "TARGET_CONTRACT_PROFILE_MISMATCH";
    throw error;
  }
  return selection;
}
