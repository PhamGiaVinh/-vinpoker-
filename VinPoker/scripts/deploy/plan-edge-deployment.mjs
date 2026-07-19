import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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

function git(repositoryRoot, args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim();
}

export function verifyCommitOnMain(repositoryRoot, sha, mainRef = "origin/main") {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("target and receipt SHAs must be 40 lowercase hexadecimal characters");
  git(repositoryRoot, ["cat-file", "-e", `${sha}^{commit}`]);
  try {
    execFileSync("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", sha, mainRef], { stdio: "ignore" });
  } catch {
    throw new Error(`commit ${sha} is not reachable from ${mainRef}`);
  }
  if (git(repositoryRoot, ["rev-parse", sha]) !== sha) throw new Error(`commit ${sha} did not resolve exactly`);
}

function receiptFor(baselines, component) {
  if (component === "frontend") return baselines.frontend ?? null;
  return baselines.functions?.[component] ?? null;
}

function diffFiles(repositoryRoot, baselineSha, targetSha, paths) {
  const output = git(repositoryRoot, ["diff", "--name-only", baselineSha, targetSha, "--", ...paths]);
  return output ? output.split(/\r?\n/).map(normalizePath).filter(Boolean).sort() : [];
}

export function buildComponentDiffs({ repositoryRoot, targetSha, baselines, manifest, mainRef = "origin/main" }) {
  verifyCommitOnMain(repositoryRoot, targetSha, mainRef);
  const result = { frontend: null, functions: {} };

  const frontendReceipt = receiptFor(baselines, "frontend");
  if (frontendReceipt?.sha) verifyCommitOnMain(repositoryRoot, frontendReceipt.sha, mainRef);
  const frontendFiles = frontendReceipt?.sha
    ? diffFiles(repositoryRoot, frontendReceipt.sha, targetSha, [...FRONTEND_PREFIXES, ...FRONTEND_FILES])
    : [];
  result.frontend = {
    baselineSha: frontendReceipt?.sha ?? null,
    baselineSource: frontendReceipt?.source ?? "missing",
    changed: frontendReceipt?.sha ? frontendFiles.some(isFrontendPath) : true,
    files: frontendFiles,
  };

  for (const [name, config] of Object.entries(manifest.functions)) {
    const receipt = receiptFor(baselines, name);
    if (receipt?.sha) verifyCommitOnMain(repositoryRoot, receipt.sha, mainRef);
    const files = receipt?.sha
      ? diffFiles(repositoryRoot, receipt.sha, targetSha, [config.path, ...SHARED_PREFIXES])
      : [];
    const directFiles = files.filter((path) => path === config.path || path.startsWith(`${config.path}/`));
    const sharedFiles = files.filter((path) => SHARED_PREFIXES.some((prefix) => path.startsWith(prefix)));
    result.functions[name] = {
      baselineSha: receipt?.sha ?? null,
      baselineSource: receipt?.source ?? "missing",
      changed: receipt?.sha ? directFiles.length > 0 || sharedFiles.length > 0 : true,
      directFiles,
      sharedFiles,
    };
  }
  return result;
}

export function buildDeploymentPlan({ event, componentDiffs, selected = [], deployFrontend = false, manifest, targetSha }) {
  if (!new Set(["push", "workflow_dispatch"]).has(event)) throw new Error(`unsupported event: ${event}`);
  const uniqueSelected = [...new Set(selected.filter(Boolean))].sort();
  if (uniqueSelected.length !== selected.filter(Boolean).length) throw new Error("selected functions must not repeat");

  const criticalChanged = Object.entries(manifest.functions)
    .filter(([name, config]) => config.critical && componentDiffs.functions[name]?.changed)
    .map(([name]) => name)
    .sort();
  const requiredForFrontend = [...criticalChanged];
  const sharedChanged = criticalChanged.some((name) => componentDiffs.functions[name].sharedFiles.length > 0)
    || Object.values(componentDiffs.functions).some((diff) => diff.sharedFiles.length > 0);

  if (event === "push") {
    const frontendChanged = componentDiffs.frontend.changed;
    const frontendHeld = frontendChanged
      && (!componentDiffs.frontend.baselineSha || requiredForFrontend.length > 0);
    return enrichPlan({
      targetSha,
      event,
      manifest,
      componentDiffs,
      criticalFunctions: [],
      criticalChanged,
      requiredForFrontend,
      frontend: frontendChanged && !frontendHeld,
      frontendHeld,
      frontendReason: !frontendChanged
        ? "frontend_unchanged_from_receipt"
        : frontendHeld
          ? (!componentDiffs.frontend.baselineSha ? "frontend_receipt_missing" : "critical_dependencies_held")
          : "frontend_diff_verified",
      sharedChanged,
    });
  }

  for (const name of uniqueSelected) {
    const config = manifest.functions[name];
    if (!config?.critical) throw new Error(`manual critical deployment is not allowed for ${name}`);
    if (!componentDiffs.functions[name]?.changed) {
      throw new Error(`selected function ${name} is unchanged from its last successful deployment receipt`);
    }
  }

  if (deployFrontend && !componentDiffs.frontend.changed) {
    throw new Error("frontend deployment was selected but frontend is unchanged from its last successful deployment receipt");
  }
  if (deployFrontend) {
    const missing = requiredForFrontend.filter((name) => !uniqueSelected.includes(name));
    if (missing.length > 0) {
      throw new Error(`frontend requires all changed critical functions to deploy first: ${missing.join(", ")}`);
    }
  }
  if (uniqueSelected.length === 0 && !deployFrontend) {
    throw new Error("manual dispatch must select at least one changed critical function or changed frontend");
  }

  return enrichPlan({
    targetSha,
    event,
    manifest,
    componentDiffs,
    criticalFunctions: uniqueSelected,
    criticalChanged,
    requiredForFrontend,
    frontend: deployFrontend,
    frontendHeld: false,
    frontendReason: deployFrontend ? "critical_dependencies_selected" : "not_selected",
    sharedChanged,
  });
}

function enrichPlan(plan) {
  const functions = Object.fromEntries(Object.entries(plan.componentDiffs.functions).map(([name, diff]) => [name, {
    ...diff,
    selected: plan.criticalFunctions.includes(name),
    held: diff.changed && !plan.criticalFunctions.includes(name),
    verifyJwt: plan.manifest.functions[name].verifyJwt,
    contractCount: plan.manifest.functions[name].contracts.length,
    denoTests: plan.manifest.functions[name].quality?.denoTests ?? [],
  }]));
  return {
    targetSha: plan.targetSha,
    event: plan.event,
    criticalFunctions: plan.criticalFunctions,
    noncriticalFunctions: [],
    criticalChanged: plan.criticalChanged,
    requiredForFrontend: plan.requiredForFrontend,
    frontend: plan.frontend,
    frontendHeld: plan.frontendHeld,
    frontendReason: plan.frontendReason,
    sharedChanged: plan.sharedChanged,
    components: {
      frontend: {
        ...plan.componentDiffs.frontend,
        contractCount: plan.manifest.frontend.contracts.length,
        vitest: plan.manifest.frontend.quality.vitest,
      },
      functions,
    },
  };
}

export function renderPlanSummary(plan) {
  const rows = Object.entries(plan.components.functions)
    .filter(([, item]) => item.changed || item.selected)
    .map(([name, item]) => `| Edge ${name} | ${item.baselineSha ?? "MISSING"} | ${item.directFiles.length} | ${item.sharedFiles.length} | ${item.selected ? "selected" : "held"} | ${item.verifyJwt ? "verify" : "no-verify"} | ${item.contractCount} |`);
  const fullDiffs = [
    ["Frontend", plan.components.frontend.baselineSha, plan.components.frontend.files],
    ...Object.entries(plan.components.functions)
      .filter(([, item]) => item.changed || item.selected)
      .map(([name, item]) => [`Edge ${name}`, item.baselineSha, [...item.directFiles, ...item.sharedFiles]]),
  ].flatMap(([label, baselineSha, files]) => [
    `<details><summary>${label} full diff</summary>`,
    "",
    baselineSha
      ? (files.length > 0 ? files.map((file) => `- \`${file}\``).join("\n") : "- No changed files")
      : "- Receipt missing; component is treated as changed until a successful receipt exists.",
    "",
    "</details>",
    "",
  ]);
  const quality = Object.entries(plan.components.functions)
    .filter(([name]) => plan.criticalFunctions.includes(name))
    .flatMap(([name, item]) => item.denoTests.map((test) => `- Edge \`${name}\`: \`deno test ${test}\``));
  if (plan.frontend) {
    quality.push("- Frontend: `npm ci --ignore-scripts` and `npm run build`");
    quality.push(...plan.components.frontend.vitest.map((test) => `- Frontend: \`vitest run ${test}\``));
  }
  return [
    "## Deployment control-plane plan",
    "",
    `- Target SHA: \`${plan.targetSha}\``,
    `- Event: \`${plan.event}\``,
    `- Frontend baseline: \`${plan.components.frontend.baselineSha ?? "MISSING"}\``,
    `- Frontend diff files: \`${plan.components.frontend.files.length}\``,
    `- Frontend decision: \`${plan.frontend ? "selected" : plan.frontendHeld ? "held" : "not selected"}\` (\`${plan.frontendReason}\`)`,
    `- Required critical Edge before frontend: \`${plan.requiredForFrontend.join(",") || "none"}\``,
    `- Shared source changed: \`${plan.sharedChanged}\``,
    "",
    "| Component | Receipt baseline | Direct diff | Shared diff | Decision | JWT | Contracts |",
    "|---|---:|---:|---:|---|---|---:|",
    ...rows,
    "",
    "### Full receipt-to-target diffs",
    "",
    ...fullDiffs,
    "### Planned quality gates",
    "",
    ...(quality.length > 0 ? quality : ["- No deployable component selected."]),
    "- Live contract probes must pass before protected-environment approval.",
  ].join("\n");
}

function writeOutputs(path, plan) {
  const lines = [
    `critical_functions=${JSON.stringify(plan.criticalFunctions)}`,
    `noncritical_functions=[]`,
    `critical_changed=${JSON.stringify(plan.criticalChanged)}`,
    `required_critical_for_frontend=${JSON.stringify(plan.requiredForFrontend)}`,
    `frontend=${String(plan.frontend)}`,
    `frontend_held=${String(plan.frontendHeld)}`,
    `frontend_reason=${plan.frontendReason}`,
    `shared_changed=${String(plan.sharedChanged)}`,
    `target_sha=${plan.targetSha}`,
  ];
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const event = args.get("event");
  const repositoryRoot = args.get("repository");
  const sha = args.get("sha");
  const baselinesPath = args.get("baselines");
  const outputPath = args.get("github-output");
  const planPath = args.get("plan-json");
  const summaryPath = args.get("summary");
  const selected = (args.get("selected") ?? "").split(",").filter(Boolean);
  const deployFrontend = args.get("deploy-frontend") === "true";
  if (!event || !repositoryRoot || !sha || !baselinesPath || !outputPath || !planPath) {
    throw new Error("event, repository, sha, baselines, github-output and plan-json are required");
  }

  const manifest = loadDeploymentManifest();
  const baselines = JSON.parse(readFileSync(baselinesPath, "utf8"));
  const componentDiffs = buildComponentDiffs({ repositoryRoot, targetSha: sha, baselines, manifest });
  const plan = buildDeploymentPlan({ event, componentDiffs, selected, deployFrontend, manifest, targetSha: sha });
  writeOutputs(outputPath, plan);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  if (summaryPath) appendFileSync(summaryPath, `${renderPlanSummary(plan)}\n`, "utf8");
  console.log(JSON.stringify({ targetSha: sha, criticalFunctions: plan.criticalFunctions, frontend: plan.frontend }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
