import fs from "node:fs";
import path from "node:path";

const EXECUTION_SAFETY = "supabase/functions/process-swing/executionSafety.ts";
const PROCESS_SWING = "supabase/functions/process-swing/index.ts";
const MANIFEST = "scripts/deploy/deployment-contracts.json";
const EXECUTION_SAFETY_TEST = "VinPoker/supabase/functions/process-swing/executionSafety.test.ts";

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function blockAfter(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) return null;
  const start = source.indexOf("{", anchorIndex);
  if (start < 0) return null;

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

function functionBodyAfter(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex < 0) return null;
  const parametersStart = source.indexOf("(", anchorIndex);
  if (parametersStart < 0) return null;

  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  if (parametersEnd < 0) return null;
  return blockAfter(source, source.slice(parametersEnd));
}

function hasNamedExecutionSafetyImport(source, symbol) {
  const match = source.match(/import\s*{([\s\S]*?)}\s*from\s*["']\.\/executionSafety\.ts["']/);
  return match?.[1].split(",").some((item) => item.trim().replace(/^type\s+/, "") === symbol) ?? false;
}

function check(ok, label, file) {
  return { ok, label, file };
}

export function inspectProcessSwingLeaseSafetyContract(root) {
  const executionSafety = read(root, EXECUTION_SAFETY);
  const processSwing = read(root, PROCESS_SWING);
  const manifest = JSON.parse(read(root, MANIFEST));
  const ownershipHelper = functionBodyAfter(executionSafety, "export async function ensureLockOwnership");
  const ownershipAssessment = functionBodyAfter(executionSafety, "export function assessLockOwnershipLoss");
  const ownershipCatch = blockAfter(processSwing, "else if (err instanceof LockOwnershipLost)");
  const registeredTests = manifest?.functions?.["process-swing"]?.quality?.denoTestsByContractProfile?.dealer_mass_open_v1;

  return [
    check(
      /export\s+async\s+function\s+ensureLockOwnership\b/.test(executionSafety)
        && /export\s+class\s+LockOwnershipLost\b/.test(executionSafety)
        && /export\s+function\s+assessLockOwnershipLoss\b/.test(executionSafety),
      "process-swing exposes typed lock-ownership safety primitives",
      EXECUTION_SAFETY,
    ),
    check(
      ownershipHelper !== null
        && /if\s*\(\s*error\s*\)[\s\S]*?new\s+LockOwnershipLost\s*\(\s*clubId\s*,\s*["']lease_check_failed["']\s*\)/.test(ownershipHelper)
        && /if\s*\(\s*data\s*!==\s*true\s*\)[\s\S]*?new\s+LockOwnershipLost\s*\(\s*clubId\s*,\s*["']lease_reclaimed["']\s*\)/.test(ownershipHelper),
      "process-swing maps lease RPC errors and lost leases to distinct fail-closed reasons",
      EXECUTION_SAFETY,
    ),
    check(
      ownershipAssessment !== null
        && ownershipAssessment.includes('"locked"')
        && ownershipAssessment.includes('"business_failed"')
        && !ownershipAssessment.includes('"completed"'),
      "lease-loss assessment cannot map directly to a completed dispatch state",
      EXECUTION_SAFETY,
    ),
    check(
      hasNamedExecutionSafetyImport(processSwing, "ensureLockOwnership")
        && hasNamedExecutionSafetyImport(processSwing, "LockOwnershipLost")
        && hasNamedExecutionSafetyImport(processSwing, "assessLockOwnershipLoss")
        && /await\s+ensureLockOwnership\s*\(/.test(processSwing),
      "process-swing invokes typed ownership guards before business passes",
      PROCESS_SWING,
    ),
    check(
      ownershipCatch !== null
        && /assessLockOwnershipLoss\s*\(\s*err\s*\)/.test(ownershipCatch)
        && /recordDispatchSafetyOutcome\s*\(\s*cid\s*,\s*ownershipOutcome\s*\)/.test(ownershipCatch)
        && !ownershipCatch.includes('"completed"'),
      "process-swing records lease-loss outcomes without finalizing the club as completed",
      PROCESS_SWING,
    ),
    check(
      Array.isArray(registeredTests) && registeredTests.includes(EXECUTION_SAFETY_TEST),
      "control-plane runs executionSafety lease-failure tests for the mass-open process-swing profile",
      MANIFEST,
    ),
  ];
}
