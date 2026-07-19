import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";

const SHARED_PREFIXES = [
  "VinPoker/supabase/functions/_shared/",
  "VinPoker/supabase/functions/_staking_shared/",
];

const FRONTEND_PREFIXES = ["VinPoker/src/", "VinPoker/public/"];
const FRONTEND_FILES = new Set([
  "VinPoker/index.html",
  "VinPoker/package.json",
  "VinPoker/package-lock.json",
  "VinPoker/postcss.config.js",
  "VinPoker/tailwind.config.ts",
  "VinPoker/tsconfig.json",
  "VinPoker/tsconfig.app.json",
  "VinPoker/tsconfig.node.json",
  "VinPoker/vite.config.ts",
  "VinPoker/vercel.json",
  "vercel.json",
]);

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isFrontendPath(path) {
  const normalized = normalizePath(path);
  return FRONTEND_FILES.has(normalized) || FRONTEND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function buildDeploymentPlan({ event, changedFiles, selected = [], deployFrontend = false, manifest }) {
  if (!new Set(["push", "workflow_dispatch"]).has(event)) throw new Error(`unsupported event: ${event}`);
  const files = [...new Set(changedFiles.map(normalizePath))].sort();
  const sharedChanged = files.some((path) => SHARED_PREFIXES.some((prefix) => path.startsWith(prefix)));

  const directlyChanged = Object.entries(manifest.functions)
    .filter(([, config]) => files.some((path) => path === config.path || path.startsWith(`${config.path}/`)))
    .map(([name]) => name)
    .sort();

  const criticalChanged = Object.entries(manifest.functions)
    .filter(([name, config]) => config.critical && (sharedChanged || directlyChanged.includes(name)))
    .map(([name]) => name)
    .sort();

  if (event === "push") {
    const noncriticalFunctions = sharedChanged
      ? []
      : directlyChanged.filter((name) => manifest.functions[name].autoDeployOnPush).sort();
    const frontendChanged = files.some(isFrontendPath);
    const frontendHeld = frontendChanged && criticalChanged.length > 0;
    return {
      criticalFunctions: [],
      noncriticalFunctions,
      criticalChanged,
      frontend: frontendChanged && !frontendHeld,
      frontendHeld,
      sharedChanged,
    };
  }

  const uniqueSelected = [...new Set(selected.filter(Boolean))].sort();
  if (uniqueSelected.length !== selected.filter(Boolean).length) throw new Error("selected functions must not repeat");
  for (const name of uniqueSelected) {
    const config = manifest.functions[name];
    if (!config?.critical) throw new Error(`manual critical deployment is not allowed for ${name}`);
    if (!sharedChanged && !directlyChanged.includes(name)) {
      throw new Error(`selected function ${name} did not change in the exact target commit`);
    }
  }

  const frontendChanged = files.some(isFrontendPath);
  if (deployFrontend && !frontendChanged) {
    throw new Error("frontend deployment was selected but frontend source did not change in the exact target commit");
  }
  if (uniqueSelected.length === 0 && !deployFrontend) {
    throw new Error("manual dispatch must select at least one changed critical function or the changed frontend");
  }

  return {
    criticalFunctions: uniqueSelected,
    noncriticalFunctions: [],
    criticalChanged,
    frontend: deployFrontend,
    frontendHeld: false,
    sharedChanged,
  };
}

function resolveDiffBase(base, sha) {
  const zeroSha = /^0{40}$/;
  if (base && !zeroSha.test(base)) {
    try {
      execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { stdio: "ignore" });
      return base;
    } catch {
      // Fall through to the exact commit's first parent.
    }
  }
  return `${sha}^`;
}

function changedFilesForCommit(event, base, sha) {
  const diffBase = event === "workflow_dispatch" ? `${sha}^` : resolveDiffBase(base, sha);
  const output = execFileSync("git", ["diff", "--name-only", diffBase, sha], { encoding: "utf8" });
  return output.split(/\r?\n/).filter(Boolean);
}

function writeOutputs(path, sha, plan) {
  const lines = [
    `critical_functions=${JSON.stringify(plan.criticalFunctions)}`,
    `noncritical_functions=${JSON.stringify(plan.noncriticalFunctions)}`,
    `critical_changed=${JSON.stringify(plan.criticalChanged)}`,
    `frontend=${String(plan.frontend)}`,
    `frontend_held=${String(plan.frontendHeld)}`,
    `shared_changed=${String(plan.sharedChanged)}`,
    `target_sha=${sha}`,
  ];
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const event = args.get("event");
  const base = args.get("base") ?? "";
  const sha = args.get("sha");
  const outputPath = args.get("github-output");
  const selected = (args.get("selected") ?? "").split(",").filter(Boolean);
  const deployFrontend = args.get("deploy-frontend") === "true";
  if (!event || !sha || !outputPath) throw new Error("event, sha and github-output are required");

  const manifest = loadDeploymentManifest();
  const changedFiles = changedFilesForCommit(event, base, sha);
  const plan = buildDeploymentPlan({ event, changedFiles, selected, deployFrontend, manifest });
  writeOutputs(outputPath, sha, plan);
  console.log(JSON.stringify({ sha, changedFiles: changedFiles.length, ...plan }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
