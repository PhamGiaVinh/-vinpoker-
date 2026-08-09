import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { HMAC_HEADERS, signRequest } from "../src/security/hmac.js";

test("HTTP Gateway exposes local dashboard and enforces signed claim", async (context) => {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbacker-automation-"));
  const key = "http-integration-local-hmac-secret";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      AUTOMATION_ENVIRONMENT: "DEV",
      AUTOMATION_GATEWAY_HOST: "127.0.0.1",
      AUTOMATION_GATEWAY_PORT: String(port),
      AUTOMATION_DB_PATH: path.join(tempDir, "gateway.sqlite"),
      AUTOMATION_HMAC_CURRENT_KEY_ID: "dev-current",
      AUTOMATION_HMAC_CURRENT_KEY: key,
      AUTOMATION_HMAC_NEXT_KEY_ID: "",
      AUTOMATION_HMAC_NEXT_KEY: "",
      AUTOMATION_AUTO_SEED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  await waitForListening(child);

  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.deepEqual(health, {
    ok: true,
    environment: "DEV",
    external_send_enabled: false,
    p0_owner: "SERVER_NATIVE",
  });
  const dashboard = await fetch(`${base}/dashboard`).then((response) => response.text());
  assert.match(dashboard, /DEV LOCAL · FIXTURE · KHÔNG PHẢI LIVE/);

  const rawBody = JSON.stringify({
    workflow_key: "owner.daily_digest.v1",
    worker_id: "http-test-worker",
    batch_size: 20,
  });
  const timestamp = new Date().toISOString();
  const nonce = "http-integration-nonce-0001";
  const requestPath = "/automation-gateway/claim";
  const signature = signRequest({
    key,
    method: "POST",
    path: requestPath,
    keyId: "dev-current",
    environment: "DEV",
    workerId: "http-test-worker",
    workflowKey: "owner.daily_digest.v1",
    timestamp,
    nonce,
    rawBody,
  });
  const headers = {
    "content-type": "application/json",
    [HMAC_HEADERS.keyId]: "dev-current",
    [HMAC_HEADERS.environment]: "DEV",
    [HMAC_HEADERS.timestamp]: timestamp,
    [HMAC_HEADERS.nonce]: nonce,
    [HMAC_HEADERS.signature]: signature,
    [HMAC_HEADERS.workerId]: "http-test-worker",
    [HMAC_HEADERS.workflowKey]: "owner.daily_digest.v1",
  };
  const firstResponse = await fetch(`${base}${requestPath}`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.ok, true);
  assert.equal(first.events.length, 2);
  assert.ok(first.events.every((item) => item.lease_token));

  const replayResponse = await fetch(`${base}${requestPath}`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  assert.equal(replayResponse.status, 401);
  const replay = await replayResponse.json();
  assert.equal(replay.error.code, "HMAC_REPLAY_DETECTED");

  const mismatchedBody = JSON.stringify({
    workflow_key: "owner.daily_digest.v1",
    worker_id: "different-worker",
    batch_size: 20,
  });
  const mismatchTimestamp = new Date().toISOString();
  const mismatchNonce = "http-integration-nonce-0002";
  const mismatchHeaders = {
    ...headers,
    [HMAC_HEADERS.timestamp]: mismatchTimestamp,
    [HMAC_HEADERS.nonce]: mismatchNonce,
    [HMAC_HEADERS.signature]: signRequest({
      key,
      method: "POST",
      path: requestPath,
      keyId: "dev-current",
      environment: "DEV",
      workerId: "http-test-worker",
      workflowKey: "owner.daily_digest.v1",
      timestamp: mismatchTimestamp,
      nonce: mismatchNonce,
      rawBody: mismatchedBody,
    }),
  };
  const mismatchResponse = await fetch(`${base}${requestPath}`, {
    method: "POST",
    headers: mismatchHeaders,
    body: mismatchedBody,
  });
  assert.equal(mismatchResponse.status, 400);
  const mismatch = await mismatchResponse.json();
  assert.equal(mismatch.error.code, "WORKER_HEADER_MISMATCH");

  const killSwitchResponse = await fetch(
    `${base}/automation-gateway/kill-switch`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: "GLOBAL",
        scope_key: "*",
        enabled: false,
      }),
    },
  );
  assert.equal(killSwitchResponse.status, 404);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Gateway did not start")), 10_000);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening on")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Gateway exited ${code}: ${stderr}`));
    });
  });
}
