import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "../src/config.js";

const workflowDir = path.join(projectRoot, "workflows");
const manifest = readJson(path.join(workflowDir, "manifest.json"));
const allowedNodes = new Set(manifest.allowed_nodes);
const forbiddenNodes = new Set(manifest.forbidden_nodes);
const findings = [];

for (const entry of manifest.workflows) {
  const file = path.join(workflowDir, entry.file);
  const workflow = readJson(file);
  if (workflow.active !== false) finding(entry.file, "workflow must remain inactive");
  if (Object.keys(workflow.pinData ?? {}).length) {
    finding(entry.file, "pinned execution data is forbidden");
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    finding(entry.file, "workflow has no nodes");
    continue;
  }
  const nodeNames = new Set(workflow.nodes.map((node) => node.name));
  for (const node of workflow.nodes) {
    if (!allowedNodes.has(node.type)) finding(entry.file, `node not allowlisted: ${node.type}`);
    if (forbiddenNodes.has(node.type)) finding(entry.file, `forbidden node: ${node.type}`);
    if (node.type === "n8n-nodes-base.httpRequest") {
      const url = node.parameters?.url;
      if (url !== "={{ 'http://gateway:8787' + $json.path }}") {
        finding(entry.file, `HTTP Request URL must be the exact Gateway origin + mapped path: ${node.name}`);
      }
    }
    if (node.type === "n8n-nodes-base.executeWorkflow") {
      const selector = node.parameters?.workflowId;
      if (
        selector?.value !== "55555555-5555-4555-8555-555555555555" ||
        selector?.mode !== "list"
      ) {
        finding(
          entry.file,
          `sub-workflow selector must use the n8n 2.32 workflowSelector format: ${node.name}`,
        );
      }
    }
    for (const credentialType of Object.keys(node.credentials ?? {})) {
      if (!manifest.credential_types.includes(credentialType)) {
        finding(entry.file, `credential type not allowlisted: ${credentialType}`);
      }
    }
  }
  for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
    if (!nodeNames.has(source)) finding(entry.file, `connection source missing: ${source}`);
    for (const target of outputs.main?.flat() ?? []) {
      if (!nodeNames.has(target.node)) {
        finding(entry.file, `connection target missing: ${target.node}`);
      }
    }
  }
}

const signer = readJson(path.join(workflowDir, "signed-gateway-request-v1.json"));
const signerTypes = new Set(signer.nodes.map((node) => node.type));
for (const required of [
  "n8n-nodes-base.crypto",
  "n8n-nodes-base.httpRequest",
  "n8n-nodes-base.executeWorkflowTrigger",
]) {
  if (!signerTypes.has(required)) finding("signed-gateway-request-v1.json", `missing ${required}`);
}
const serializedSigner = JSON.stringify(signer);
for (const header of [
  "x-vbacker-key-id",
  "x-vbacker-environment",
  "x-vbacker-timestamp",
  "x-vbacker-nonce",
  "x-vbacker-signature",
  "x-vbacker-worker-id",
  "x-vbacker-workflow-key",
]) {
  if (!serializedSigner.includes(header)) {
    finding("signed-gateway-request-v1.json", `missing HMAC header ${header}`);
  }
}
const signerPathMap = signer.nodes
  .find((node) => node.name === "Prepare Exact Body")
  ?.parameters?.assignments?.assignments
  ?.find((assignment) => assignment.name === "path")?.value;
if (
  signerPathMap !==
  "={{ ({ CLAIM: '/automation-gateway/claim', PREFLIGHT: '/automation-gateway/preflight', DIGEST_ARTIFACT: '/automation-gateway/artifacts/owner-daily-digest', ENQUEUE: '/automation-gateway/notifications/enqueue', COMPLETE: '/automation-gateway/complete', FAIL: '/automation-gateway/fail', HEARTBEAT: '/automation-gateway/heartbeat' }[$json.gateway_operation] ?? '/__blocked__') }}"
) {
  finding("signed-gateway-request-v1.json", "gateway operation map is missing or changed");
}
const canonical = signer.nodes
  .find((node) => node.name === "Build Canonical Request")
  ?.parameters?.assignments?.assignments
  ?.find((assignment) => assignment.name === "canonical")?.value;
for (const field of [
  "$json.key_id",
  "$json.environment",
  "$json.worker_id",
  "$json.workflow_key",
]) {
  if (!canonical?.includes(field)) {
    finding("signed-gateway-request-v1.json", `canonical signature omits ${field}`);
  }
}

if (findings.length) {
  process.stderr.write(`FAIL: workflow guardrails\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `PASS: ${manifest.workflows.length} inactive workflows use only allowlisted local nodes and destinations.\n`,
  );
}

function finding(file, message) {
  findings.push(`- ${file}: ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
