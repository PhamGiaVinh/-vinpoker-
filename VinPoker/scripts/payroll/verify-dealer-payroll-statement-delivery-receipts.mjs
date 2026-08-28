#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { fetchDeploymentBaselines } from "../deploy/deployment-receipts.mjs";
import { loadDeploymentManifest } from "../deploy/deployment-manifest.mjs";

export const REQUIRED_COMPONENTS = Object.freeze([
  "frontend",
  "render-payroll-statement",
  "send-payroll-statement",
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

function assertSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error("source SHA must be 40 lowercase hexadecimal characters");
}

export function expectedReceiptShas(value) {
  const expected = typeof value === "string"
    ? Object.fromEntries(REQUIRED_COMPONENTS.map((component) => [component, value]))
    : value;
  for (const component of REQUIRED_COMPONENTS) assertSha(expected?.[component]);
  return expected;
}

export function receiptProblems(baselines, expectedValue) {
  const expected = expectedReceiptShas(expectedValue);
  const values = {
    frontend: baselines?.frontend,
    "render-payroll-statement": baselines?.functions?.["render-payroll-statement"],
    "send-payroll-statement": baselines?.functions?.["send-payroll-statement"],
  };
  const problems = [];
  for (const component of REQUIRED_COMPONENTS) {
    const receipt = values[component];
    if (!receipt) problems.push(`${component} receipt missing`);
    else if (receipt.sha !== expected[component]) problems.push(`${component} receipt SHA mismatch`);
  }
  return problems;
}

function expectedFromArgs(args) {
  const shared = args.get("sha");
  const split = {
    frontend: args.get("frontend-sha"),
    "render-payroll-statement": args.get("render-sha"),
    "send-payroll-statement": args.get("sender-sha"),
  };
  const splitCount = Object.values(split).filter(Boolean).length;
  if (shared && splitCount > 0) throw new Error("--sha cannot be combined with component receipt SHAs");
  if (shared) return expectedReceiptShas(shared);
  if (splitCount !== REQUIRED_COMPONENTS.length) {
    throw new Error("provide --sha or all of --frontend-sha, --render-sha, and --sender-sha");
  }
  return expectedReceiptShas(split);
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const args = parseArgs(argv);
  const repository = args.get("repository") ?? env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("--repository is required");
  const expected = expectedFromArgs(args);
  if (!env.GITHUB_TOKEN && !env.GH_TOKEN) throw new Error("GITHUB_TOKEN is required");

  const baselines = await fetchDeploymentBaselines({
    repository,
    token: env.GITHUB_TOKEN ?? env.GH_TOKEN,
    manifest: loadDeploymentManifest(),
    fetchImpl,
  });
  const problems = receiptProblems(baselines, expected);
  if (problems.length) throw new Error(`Payroll delivery deployment receipts are not exact: ${problems.join("; ")}`);
  console.log("[dealer-payroll-delivery-receipts] PASS component receipts verified");
  return baselines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`[dealer-payroll-delivery-receipts] FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
