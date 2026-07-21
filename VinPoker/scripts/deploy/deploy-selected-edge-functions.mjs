import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadDeploymentManifest, parseTargetList } from "./deployment-manifest.mjs";

function parseArgs(argv) {
  const targetsIndex = argv.indexOf("--targets");
  const rootIndex = argv.indexOf("--target-root");
  if (targetsIndex === -1 || argv[targetsIndex + 1] === undefined) throw new Error("targets are required");
  if (rootIndex === -1 || argv[rootIndex + 1] === undefined) throw new Error("target-root is required");
  return { targets: parseTargetList(argv[targetsIndex + 1]), targetRoot: argv[rootIndex + 1] };
}

export function deploymentArguments(name, config) {
  const args = ["functions", "deploy", name];
  if (!config.verifyJwt) args.push("--no-verify-jwt");
  return args;
}

function deploy(name, config, targetRoot) {
  const sourceDirectory = resolve(targetRoot, config.path);
  if (!existsSync(resolve(sourceDirectory, "index.ts"))) {
    throw new Error(`target function source is missing: ${config.path}/index.ts`);
  }
  const args = deploymentArguments(name, config);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Deploying reviewed function ${name} (attempt ${attempt}/3)`);
    const result = spawnSync("supabase", args, {
      cwd: resolve(targetRoot, "VinPoker"),
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status === 0) return;
  }
  throw new Error(`deployment failed for ${name}`);
}

function run() {
  const { targets, targetRoot } = parseArgs(process.argv.slice(2));
  if (targets.length === 0) throw new Error("at least one function must be selected");
  const manifest = loadDeploymentManifest();
  for (const name of targets) {
    const config = manifest.functions[name];
    if (!config) throw new Error(`unknown deployment target: ${name}`);
    deploy(name, config, targetRoot);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
