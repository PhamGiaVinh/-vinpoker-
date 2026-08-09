import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const keyClassification = new Map([
  ["AUTOMATION_ENVIRONMENT", "LOCAL_RUNTIME"],
  ["AUTOMATION_GATEWAY_HOST", "LOCAL_RUNTIME"],
  ["AUTOMATION_GATEWAY_PORT", "LOCAL_RUNTIME"],
  ["AUTOMATION_DB_PATH", "LOCAL_RUNTIME"],
  ["AUTOMATION_HMAC_CURRENT_KEY", "RANDOM_DEV_SECRET"],
  ["AUTOMATION_HMAC_NEXT_KEY", "RANDOM_DEV_SECRET"],
  ["N8N_DB_PASSWORD", "RANDOM_DEV_SECRET"],
  ["N8N_ENCRYPTION_KEY", "RANDOM_DEV_SECRET"],
  ["AUTOMATION_HMAC_CURRENT_KEY_ID", "TEST_FIXTURE"],
  ["AUTOMATION_HMAC_NEXT_KEY_ID", "TEST_FIXTURE"],
  ["AUTOMATION_HMAC_REPLAY_WINDOW_SECONDS", "TEST_FIXTURE"],
  ["AUTOMATION_HMAC_NONCE_TTL_SECONDS", "TEST_FIXTURE"],
  ["AUTOMATION_RATE_LIMIT_PER_MINUTE", "TEST_FIXTURE"],
]);

const productionProjectRef = ["orles", "ggcjamwuknxwcpk"].join("");
const disallowedName = /^(?:SUPABASE_SERVICE_ROLE_KEY|VERCEL_TOKEN|ONESIGNAL_|TELEGRAM_BOT_TOKEN|SMTP_PASSWORD|SEPAY_|PAYMENT_|PROD_)/i;
const disallowedReference = new RegExp(
  `(?:${productionProjectRef}|\\.supabase\\.co|vinpoker\\.vercel\\.app|functions\\.supabase|api\\.telegram\\.org|onesignal|resend\\.com|sepay|stripe\\.com|sendgrid|mailgun|twilio|\\bservice_role\\b|\\bvcp_[A-Za-z0-9_-]{20,}\\b|\\beyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}\\b)`,
  "i",
);
const realRecipient = /(?:\b[a-z0-9._%+-]+@[a-z0-9.-]+\.(?!invalid\b)[a-z]{2,}\b|(?<!\d)(?:\+?84\d{9}|0\d{9})(?!\d))/i;
const unsafePlaceholder = /(?:changeme|password|secret|replace-|placeholder|local-only)/i;
const secretKeys = [
  "AUTOMATION_HMAC_CURRENT_KEY",
  "AUTOMATION_HMAC_NEXT_KEY",
  "N8N_DB_PASSWORD",
  "N8N_ENCRYPTION_KEY",
];

export function validateLocalEnvPolicy({ projectRoot, envPath = path.join(projectRoot, ".env") } = {}) {
  const issues = [];
  if (!projectRoot || !fs.existsSync(envPath)) {
    return { valid: false, classifications: [], issues: [{ code: "LOCAL_ENV_MISSING" }] };
  }

  const relativeEnvPath = path.relative(projectRoot, envPath).replaceAll("\\", "/");
  if (!isGitIgnored(projectRoot, relativeEnvPath)) {
    issues.push({ code: "LOCAL_ENV_NOT_GIT_IGNORED", variable: relativeEnvPath });
  }

  const parsed = parseEnvironmentFile(fs.readFileSync(envPath, "utf8"));
  issues.push(...parsed.issues);
  const entries = parsed.entries;
  const classifications = [...entries.keys()]
    .sort()
    .map((key) => ({ key, classification: keyClassification.get(key) ?? "DISALLOWED_PRODUCTION_REFERENCE" }));

  for (const [key, value] of entries) {
    if (!keyClassification.has(key) || disallowedName.test(key)) {
      issues.push({ code: "DISALLOWED_VARIABLE", variable: key });
      continue;
    }
    if (disallowedReference.test(value)) {
      issues.push({ code: "DISALLOWED_PRODUCTION_REFERENCE", variable: key });
    }
    if (realRecipient.test(value)) {
      issues.push({ code: "REAL_RECIPIENT_REFERENCE", variable: key });
    }
  }

  for (const key of keyClassification.keys()) {
    if (!entries.has(key)) issues.push({ code: "REQUIRED_VARIABLE_MISSING", variable: key });
  }

  validateLocalRuntime(entries, issues);
  validateRandomSecrets(entries, issues);

  return { valid: issues.length === 0, classifications, issues };
}

export function formatLocalEnvPolicy(result) {
  const classifications = result.classifications
    .map(({ key, classification }) => `${key} = ${classification}`)
    .join("\n");
  if (result.valid) return `PASS: local runtime environment policy\n${classifications}`;
  return `FAIL: local runtime environment policy\n- ${result.issues
    .map(({ code, variable }) => (variable ? `${variable}: ${code}` : code))
    .join("\n- ")}`;
}

export function parseEnvironmentFile(text) {
  const entries = new Map();
  const issues = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) {
      issues.push({ code: "MALFORMED_ENV_LINE", variable: `line-${index + 1}` });
      continue;
    }
    const [, key, rawValue] = match;
    if (entries.has(key)) {
      issues.push({ code: "DUPLICATE_VARIABLE", variable: key });
      continue;
    }
    entries.set(key, unquote(rawValue));
  }
  return { entries, issues };
}

function validateLocalRuntime(entries, issues) {
  if (entries.get("AUTOMATION_ENVIRONMENT") !== "DEV") {
    issues.push({ code: "ENVIRONMENT_MUST_BE_DEV", variable: "AUTOMATION_ENVIRONMENT" });
  }
  if (!["127.0.0.1", "localhost"].includes(entries.get("AUTOMATION_GATEWAY_HOST"))) {
    issues.push({ code: "GATEWAY_HOST_MUST_BE_LOCAL", variable: "AUTOMATION_GATEWAY_HOST" });
  }
  const port = Number(entries.get("AUTOMATION_GATEWAY_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({ code: "GATEWAY_PORT_INVALID", variable: "AUTOMATION_GATEWAY_PORT" });
  }
  const dbPath = entries.get("AUTOMATION_DB_PATH") ?? "";
  const localDatabasePath =
    /^\.local-data[\\/][A-Za-z0-9._-]+\.sqlite$/.test(dbPath) ||
    /^\/data\/[A-Za-z0-9._-]+\.sqlite$/.test(dbPath);
  if (!localDatabasePath) {
    issues.push({ code: "DB_PATH_MUST_BE_LOCAL", variable: "AUTOMATION_DB_PATH" });
  }
  for (const key of ["AUTOMATION_HMAC_CURRENT_KEY_ID", "AUTOMATION_HMAC_NEXT_KEY_ID"]) {
    if (!/^dev-[A-Za-z0-9._:-]{1,60}$/.test(entries.get(key) ?? "")) {
      issues.push({ code: "DEV_KEY_ID_INVALID", variable: key });
    }
  }
}

function validateRandomSecrets(entries, issues) {
  for (const key of secretKeys) {
    const value = entries.get(key) ?? "";
    const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
    if (Buffer.byteLength(value, "utf8") < 32 || characterClasses < 3 || unsafePlaceholder.test(value)) {
      issues.push({ code: "RANDOM_DEV_SECRET_REQUIRED", variable: key });
    }
  }
}

function isGitIgnored(projectRoot, relativePath) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", relativePath], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
