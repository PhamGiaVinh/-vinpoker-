import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest } from "./deployment-manifest.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return { command, args };
}

function assertSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("receipt SHA must be 40 lowercase hexadecimal characters");
}

export function receiptComponents(manifest) {
  const entries = [["frontend", manifest.frontend.receiptEnvironment]];
  for (const [name, config] of Object.entries(manifest.functions)) {
    if (config.critical) entries.push([name, config.receiptEnvironment]);
  }
  return Object.fromEntries(entries);
}

export function selectLatestSuccessfulReceipt(deployments, statusesByDeployment) {
  const ordered = [...deployments].sort((left, right) =>
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")) || Number(right.id) - Number(left.id));
  for (const deployment of ordered) {
    const statuses = statusesByDeployment.get(String(deployment.id)) ?? [];
    if (statuses.some((status) => status.state === "success")) {
      assertSha(deployment.sha);
      return {
        sha: deployment.sha,
        source: "github_deployment_receipt",
        deploymentId: deployment.id,
        createdAt: deployment.created_at ?? null,
      };
    }
  }
  return null;
}

function githubHeaders(token) {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`GitHub deployment receipt API failed with HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function fetchDeploymentBaselines({ repository, token, manifest, fetchImpl = fetch }) {
  const components = receiptComponents(manifest);
  const output = { frontend: null, functions: {} };
  for (const [component, environment] of Object.entries(components)) {
    const query = new URLSearchParams({ environment, per_page: "100" });
    const deployments = await githubJson(
      fetchImpl,
      `https://api.github.com/repos/${repository}/deployments?${query}`,
      { headers: githubHeaders(token) },
    );
    const statuses = new Map();
    for (const deployment of deployments) {
      statuses.set(String(deployment.id), await githubJson(
        fetchImpl,
        `https://api.github.com/repos/${repository}/deployments/${deployment.id}/statuses?per_page=100`,
        { headers: githubHeaders(token) },
      ));
    }
    const receipt = selectLatestSuccessfulReceipt(deployments, statuses);
    if (component === "frontend") output.frontend = receipt;
    else output.functions[component] = receipt;
  }
  return output;
}

export async function recordSuccessfulReceipt({ repository, token, component, targetSha, manifest, fetchImpl = fetch }) {
  assertSha(targetSha);
  const environment = receiptComponents(manifest)[component];
  if (!environment) throw new Error(`component ${component} has no deployment receipt environment`);
  const deployment = await githubJson(fetchImpl, `https://api.github.com/repos/${repository}/deployments`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      ref: targetSha,
      auto_merge: false,
      required_contexts: [],
      environment,
      transient_environment: false,
      production_environment: true,
      description: `Successful reviewed deployment receipt for ${component}`,
      payload: { component, control_plane_schema: manifest.schemaVersion },
    }),
  });
  await githubJson(fetchImpl, `https://api.github.com/repos/${repository}/deployments/${deployment.id}/statuses`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ state: "success", environment, description: `Deployed ${targetSha}` }),
  });
  return { component, targetSha, deploymentId: deployment.id, environment };
}

export async function deployAndRecordReceipt({ deploy, record }) {
  await deploy();
  return record();
}

async function run() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const manifest = loadDeploymentManifest();
  const repository = args.get("repository") ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!repository) throw new Error("repository is required");

  if (command === "fetch") {
    const output = args.get("output");
    if (!output) throw new Error("fetch requires --output");
    const baselines = await fetchDeploymentBaselines({ repository, token, manifest });
    writeFileSync(output, `${JSON.stringify(baselines, null, 2)}\n`, "utf8");
    console.log("Deployment receipt baselines loaded.");
    return;
  }
  if (command === "record") {
    const component = args.get("component");
    const targetSha = args.get("sha");
    if (!component || !targetSha) throw new Error("record requires --component and --sha");
    const receipt = await recordSuccessfulReceipt({ repository, token, component, targetSha, manifest });
    console.log(`Recorded successful deployment receipt for ${receipt.component} at ${receipt.targetSha}.`);
    return;
  }
  throw new Error("command must be fetch or record");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
