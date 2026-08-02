import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { contractError } from "../contracts/validator.js";

export const HMAC_HEADERS = {
  keyId: "x-vbacker-key-id",
  environment: "x-vbacker-environment",
  timestamp: "x-vbacker-timestamp",
  nonce: "x-vbacker-nonce",
  signature: "x-vbacker-signature",
  workerId: "x-vbacker-worker-id",
  workflowKey: "x-vbacker-workflow-key",
};

export function bodySha256(rawBody = "") {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function canonicalRequest({
  method,
  path,
  keyId,
  environment,
  workerId,
  workflowKey,
  timestamp,
  nonce,
  rawBody = "",
}) {
  return [
    method.toUpperCase(),
    path,
    keyId,
    environment,
    workerId,
    workflowKey,
    timestamp,
    nonce,
    bodySha256(rawBody),
  ].join("\n");
}

export function signRequest({ key, ...request }) {
  return createHmac("sha256", key)
    .update(canonicalRequest(request), "utf8")
    .digest("hex");
}

export function createHmacVerifier({ config, nonceStore, rateLimiter, now = () => Date.now() }) {
  const keyring = new Map([[config.currentKeyId, config.currentKey]]);
  if (config.nextKeyId && config.nextKey) keyring.set(config.nextKeyId, config.nextKey);

  return function verify({ method, path, rawBody, headers }) {
    const keyId = header(headers, HMAC_HEADERS.keyId);
    const environment = header(headers, HMAC_HEADERS.environment);
    const timestamp = header(headers, HMAC_HEADERS.timestamp);
    const nonce = header(headers, HMAC_HEADERS.nonce);
    const suppliedSignature = header(headers, HMAC_HEADERS.signature);
    const workerId = header(headers, HMAC_HEADERS.workerId);
    const workflowKey = header(headers, HMAC_HEADERS.workflowKey);

    if (
      !keyId ||
      !environment ||
      !timestamp ||
      !nonce ||
      !suppliedSignature ||
      !workerId ||
      !workflowKey
    ) {
      throw contractError("HMAC_HEADERS_MISSING", "Required HMAC headers are missing");
    }
    if (environment !== config.environment) {
      throw contractError("CROSS_ENVIRONMENT_DENIED", "Credential environment mismatch");
    }
    const key = keyring.get(keyId);
    if (!key) throw contractError("UNKNOWN_HMAC_KEY", "Unknown HMAC key id");
    if (
      !/^[a-zA-Z0-9._:-]{2,128}$/.test(workerId) ||
      !/^[a-zA-Z0-9._:-]{2,128}$/.test(workflowKey)
    ) {
      throw contractError("HMAC_CONTEXT_INVALID", "Worker or workflow context is invalid");
    }

    const parsedTimestamp = Date.parse(timestamp);
    if (!Number.isFinite(parsedTimestamp)) {
      throw contractError("INVALID_HMAC_TIMESTAMP", "HMAC timestamp is invalid");
    }
    const drift = Math.abs(now() - parsedTimestamp);
    if (drift > config.replayWindowSeconds * 1000) {
      throw contractError("HMAC_TIMESTAMP_EXPIRED", "HMAC timestamp is outside replay window");
    }
    if (!/^[a-zA-Z0-9._:-]{8,180}$/.test(nonce)) {
      throw contractError("INVALID_HMAC_NONCE", "HMAC nonce format is invalid");
    }

    const expected = signRequest({
      key,
      method,
      path,
      keyId,
      environment,
      workerId,
      workflowKey,
      timestamp,
      nonce,
      rawBody,
    });
    if (!safeEqual(expected, suppliedSignature)) {
      throw contractError("HMAC_SIGNATURE_INVALID", "HMAC signature does not match");
    }

    nonceStore.consumeNonce({
      keyId,
      nonce,
      expiresAt: new Date(now() + config.nonceTtlSeconds * 1000).toISOString(),
    });

    rateLimiter.consumeRateLimit({
      bucketKey: `${environment}:${workerId}:${workflowKey}`,
      limit: config.rateLimitPerMinute,
      nowMs: now(),
    });

    return { keyId, environment, workerId, workflowKey };
  };
}

function header(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) ?? "";
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? "";
}

function safeEqual(expected, actual) {
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    !/^[a-f0-9]{64}$/.test(String(actual))
  ) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
