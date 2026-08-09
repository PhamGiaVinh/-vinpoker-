import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRepositorySecretScan,
  scanRepositorySecretLeaks,
} from "../scripts/lib/repository-secret-scanner.js";
import {
  formatLocalEnvPolicy,
  validateLocalEnvPolicy,
} from "../scripts/lib/local-env-policy.js";

test("tracked source containing a secret-like value fails repository scan", (t) => {
  const root = createFixture(t);
  const leakedValue = `vcp_${"a".repeat(24)}`;
  write(root, "src/example.js", `const API_SECRET = \"${leakedValue}\";\n`);
  stage(root, "src/example.js");

  assertFinding(scan(root), "src/example.js", "possible hardcoded secret");
});

test("tracked workflow export containing a secret-like value fails repository scan", (t) => {
  const root = createFixture(t);
  const leakedValue = `vcp_${"b".repeat(24)}`;
  write(root, "workflows/export.json", `{\"token\":\"${leakedValue}\"}`);
  stage(root, "workflows/export.json");

  assertFinding(scan(root), "workflows/export.json", "Vercel token-like value");
});

test("untracked publishable workflow export is still scanned", (t) => {
  const root = createFixture(t);
  const leakedValue = `vcp_${"c".repeat(24)}`;
  write(root, "workflows/untracked-export.json", `{\"token\":\"${leakedValue}\"}`);

  assertFinding(scan(root), "workflows/untracked-export.json", "Vercel token-like value");
});

test("Git-ignored local .env with random DEV secrets is outside repository leak scan", (t) => {
  const root = createFixture(t, { ignoreEnv: true });
  write(root, ".env", safeEnv());

  assert.equal(scan(root).findings.length, 0);
});

test("local environment validator fails when .env is not Git-ignored", (t) => {
  const root = createFixture(t);
  write(root, ".env", safeEnv());

  assertIssue(validate(root), "LOCAL_ENV_NOT_GIT_IGNORED");
});

test("local environment validator rejects provider credentials and production targets", (t) => {
  const root = createFixture(t, { ignoreEnv: true });
  write(root, ".env", `${safeEnv()}TELEGRAM_BOT_TOKEN=${randomValue("provider")}\n`);

  assertIssue(validate(root), "DISALLOWED_VARIABLE");
});

test("safe local DEV .env passes policy and reports classifications without values", (t) => {
  const root = createFixture(t, { ignoreEnv: true });
  const env = safeEnv();
  write(root, ".env", env);

  const result = validate(root);
  assert.equal(result.valid, true);
  const output = formatLocalEnvPolicy(result);
  const hmacClassification = result.classifications.find(
    ({ key }) => key === "AUTOMATION_HMAC_CURRENT_KEY",
  );
  assert.equal(hmacClassification?.classification, "RANDOM_DEV_SECRET");
  assert.match(output, /RANDOM_DEV_SECRET/);
  assert.doesNotMatch(output, new RegExp(randomValue("current")));
});

test(".env.example containing a real secret fails even when it is only a template", (t) => {
  const root = createFixture(t);
  const leakedValue = randomValue("template");
  write(root, ".env.example", `N8N_DB_PASSWORD=${leakedValue}\n`);

  assertFinding(scan(root), ".env.example", "possible hardcoded secret");
});

test("repository scanner failure output never echoes the detected secret value", (t) => {
  const root = createFixture(t);
  const leakedValue = `vcp_${"d".repeat(24)}`;
  write(root, "src/private.js", `const API_SECRET = \"${leakedValue}\";\n`);
  stage(root, "src/private.js");

  const output = formatRepositorySecretScan(scan(root));
  assert.match(output, /src\/private\.js: Vercel token-like value/);
  assert.doesNotMatch(output, new RegExp(leakedValue));
});

function createFixture(t, { ignoreEnv = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vbacker-verification-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (ignoreEnv) write(root, ".gitignore", ".env\n");
  else write(root, ".gitignore", "");
  exec(root, ["init", "-q"]);
  stage(root, ".gitignore");
  return root;
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function stage(root, relative) {
  exec(root, ["add", "--", relative]);
}

function exec(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function scan(projectRoot) {
  return scanRepositorySecretLeaks({ projectRoot });
}

function validate(projectRoot) {
  return validateLocalEnvPolicy({ projectRoot, envPath: path.join(projectRoot, ".env") });
}

function assertFinding(result, relative, label) {
  assert.equal(result.findings.some((finding) => finding.relative === relative && finding.label === label), true);
}

function assertIssue(result, code) {
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.code === code), true);
}

function safeEnv() {
  return [
    "AUTOMATION_ENVIRONMENT=DEV",
    "AUTOMATION_GATEWAY_HOST=127.0.0.1",
    "AUTOMATION_GATEWAY_PORT=8787",
    "AUTOMATION_DB_PATH=.local-data/automation-dev.sqlite",
    "AUTOMATION_HMAC_CURRENT_KEY_ID=dev-current",
    `AUTOMATION_HMAC_CURRENT_KEY=${randomValue("current")}`,
    "AUTOMATION_HMAC_NEXT_KEY_ID=dev-next",
    `AUTOMATION_HMAC_NEXT_KEY=${randomValue("next")}`,
    "AUTOMATION_HMAC_REPLAY_WINDOW_SECONDS=300",
    "AUTOMATION_HMAC_NONCE_TTL_SECONDS=600",
    "AUTOMATION_RATE_LIMIT_PER_MINUTE=120",
    `N8N_DB_PASSWORD=${randomValue("database")}`,
    `N8N_ENCRYPTION_KEY=${randomValue("encryption")}`,
    "",
  ].join("\n");
}

function randomValue(label) {
  return `${label}-Aa9!${"q".repeat(40)}`;
}
