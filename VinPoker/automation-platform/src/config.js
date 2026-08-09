import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDir, "..");

function integer(value, fallback, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function loadConfig(overrides = {}) {
  const environment =
    overrides.environment ?? process.env.AUTOMATION_ENVIRONMENT ?? "DEV";
  if (!["DEV", "TEST", "PROD"].includes(environment)) {
    throw new Error("AUTOMATION_ENVIRONMENT must be DEV, TEST or PROD");
  }

  const currentKeyId =
    overrides.currentKeyId ?? process.env.AUTOMATION_HMAC_CURRENT_KEY_ID ?? "";
  const currentKey =
    overrides.currentKey ?? process.env.AUTOMATION_HMAC_CURRENT_KEY ?? "";
  const nextKeyId =
    overrides.nextKeyId ?? process.env.AUTOMATION_HMAC_NEXT_KEY_ID ?? "";
  const nextKey = overrides.nextKey ?? process.env.AUTOMATION_HMAC_NEXT_KEY ?? "";

  return {
    environment,
    host:
      overrides.host ??
      process.env.AUTOMATION_GATEWAY_HOST ??
      "127.0.0.1",
    port: integer(
      overrides.port ?? process.env.AUTOMATION_GATEWAY_PORT,
      8787,
      "AUTOMATION_GATEWAY_PORT",
      { min: 1, max: 65535 },
    ),
    dbPath:
      overrides.dbPath ??
      process.env.AUTOMATION_DB_PATH ??
      path.join(projectRoot, ".local-data", "automation-dev.sqlite"),
    currentKeyId,
    currentKey,
    nextKeyId,
    nextKey,
    replayWindowSeconds: integer(
      overrides.replayWindowSeconds ??
        process.env.AUTOMATION_HMAC_REPLAY_WINDOW_SECONDS,
      300,
      "AUTOMATION_HMAC_REPLAY_WINDOW_SECONDS",
      { min: 30, max: 900 },
    ),
    nonceTtlSeconds: integer(
      overrides.nonceTtlSeconds ?? process.env.AUTOMATION_HMAC_NONCE_TTL_SECONDS,
      600,
      "AUTOMATION_HMAC_NONCE_TTL_SECONDS",
      { min: 60, max: 3600 },
    ),
    rateLimitPerMinute: integer(
      overrides.rateLimitPerMinute ?? process.env.AUTOMATION_RATE_LIMIT_PER_MINUTE,
      120,
      "AUTOMATION_RATE_LIMIT_PER_MINUTE",
      { min: 1, max: 10000 },
    ),
    autoSeed:
      overrides.autoSeed ??
      String(process.env.AUTOMATION_AUTO_SEED ?? "false").toLowerCase() === "true",
  };
}

export function assertRuntimeSecrets(config) {
  const badValues = new Set([
    "",
    "replace-with-random-local-key",
    "replace-with-another-random-local-key",
    "replace-with-next-random-local-key",
  ]);

  if (
    badValues.has(config.currentKeyId) ||
    badValues.has(config.currentKey) ||
    (config.nextKeyId && badValues.has(config.nextKeyId)) ||
    (config.nextKey && badValues.has(config.nextKey))
  ) {
    throw new Error(
      "Missing DEV HMAC credential. Set AUTOMATION_HMAC_CURRENT_KEY_ID and AUTOMATION_HMAC_CURRENT_KEY.",
    );
  }
  if (!/^[a-zA-Z0-9._:-]{2,64}$/.test(config.currentKeyId)) {
    throw new Error("AUTOMATION_HMAC_CURRENT_KEY_ID has an invalid format");
  }
  if (Buffer.byteLength(config.currentKey, "utf8") < 32) {
    throw new Error("AUTOMATION_HMAC_CURRENT_KEY must contain at least 32 bytes");
  }

  if ((config.nextKeyId && !config.nextKey) || (!config.nextKeyId && config.nextKey)) {
    throw new Error("Next HMAC key id and key must be configured together");
  }
  if (config.nextKey && Buffer.byteLength(config.nextKey, "utf8") < 32) {
    throw new Error("AUTOMATION_HMAC_NEXT_KEY must contain at least 32 bytes");
  }
  if (config.nextKeyId && !/^[a-zA-Z0-9._:-]{2,64}$/.test(config.nextKeyId)) {
    throw new Error("AUTOMATION_HMAC_NEXT_KEY_ID has an invalid format");
  }
  if (config.nextKeyId && config.nextKeyId === config.currentKeyId) {
    throw new Error("HMAC current and next key IDs must differ during rotation");
  }
}
