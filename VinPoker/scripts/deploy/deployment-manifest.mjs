import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST_PATH = resolve(scriptDirectory, "deployment-contracts.json");

const REQUIRED_CRITICAL_POSTURE = new Map([
  ["process-swing", false],
  ["mass-assign", true],
  ["checkout-dealer", true],
]);

export function loadDeploymentManifest(path = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  validateDeploymentManifest(manifest);
  return manifest;
}

export function validateDeploymentManifest(manifest, repositoryRoot) {
  if (manifest?.schemaVersion !== 1) throw new Error("deployment manifest schemaVersion must be 1");
  if (typeof manifest.criticalEnvironment !== "string" || !manifest.criticalEnvironment) {
    throw new Error("deployment manifest must name a criticalEnvironment");
  }
  if (!manifest.frontend || !Array.isArray(manifest.frontend.contracts) || manifest.frontend.contracts.length === 0) {
    throw new Error("frontend live contracts must be declared");
  }
  if (!manifest.functions || typeof manifest.functions !== "object") {
    throw new Error("deployment manifest functions must be an object");
  }

  for (const [name, expectedVerifyJwt] of REQUIRED_CRITICAL_POSTURE) {
    const config = manifest.functions[name];
    if (!config) throw new Error(`critical function ${name} is missing from the deployment manifest`);
    if (config.critical !== true) throw new Error(`critical function ${name} must be marked critical`);
    if (config.autoDeployOnPush !== false) throw new Error(`critical function ${name} must stay manual-only`);
    if (config.verifyJwt !== expectedVerifyJwt) {
      throw new Error(`critical function ${name} has an unexpected verifyJwt posture`);
    }
  }

  const seenPaths = new Set();
  for (const [name, config] of Object.entries(manifest.functions)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid Edge function name: ${name}`);
    if (typeof config.path !== "string" || !config.path.startsWith("VinPoker/supabase/functions/")) {
      throw new Error(`invalid source path for ${name}`);
    }
    if (seenPaths.has(config.path)) throw new Error(`duplicate source path in manifest: ${config.path}`);
    seenPaths.add(config.path);
    if (typeof config.critical !== "boolean" || typeof config.autoDeployOnPush !== "boolean") {
      throw new Error(`critical/autoDeployOnPush must be boolean for ${name}`);
    }
    if (config.critical && config.autoDeployOnPush) {
      throw new Error(`critical function ${name} cannot auto-deploy on push`);
    }
    if (typeof config.verifyJwt !== "boolean") throw new Error(`verifyJwt must be boolean for ${name}`);
    if (!Array.isArray(config.contracts) || config.contracts.length === 0) {
      throw new Error(`live contracts are missing for ${name}`);
    }
    if (repositoryRoot && !existsSync(resolve(repositoryRoot, config.path))) {
      throw new Error(`source path does not exist for ${name}: ${config.path}`);
    }
  }

  return manifest;
}

export function parseTargetList(rawTargets) {
  let targets;
  if (rawTargets.trim().startsWith("[")) {
    try {
      targets = JSON.parse(rawTargets);
    } catch {
      throw new Error("targets must be a JSON array or a comma-separated function list");
    }
  } else {
    targets = rawTargets.split(",").map((target) => target.trim()).filter(Boolean);
  }
  if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string")) {
    throw new Error("targets must contain function names");
  }
  if (new Set(targets).size !== targets.length) throw new Error("targets must not contain duplicates");
  return targets;
}
