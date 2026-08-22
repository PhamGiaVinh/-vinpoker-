import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_API_VERSION = "v1beta";
const MAX_REQUESTS_PER_MINUTE = 6;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 512;

export interface TrackerVoiceGeminiUatEnvironment {
  VERCEL_ENV?: string;
  TRACKER_VOICE_UAT_ENABLED?: string;
  GEMINI_API_KEY?: string;
}

export interface TrackerVoiceGeminiUatRequest {
  method?: string;
  clientIp: string;
}

export interface TrackerVoiceGeminiUatResponse {
  status: number;
  body: Record<string, string>;
}

interface GeminiAuthTokenResponse {
  name?: unknown;
  expireTime?: unknown;
}

interface GeminiProvisioningError {
  status: number;
}

interface TrackerVoiceGeminiUatDependencies {
  tokenCreator?: (environment: TrackerVoiceGeminiUatEnvironment, now: number) => Promise<GeminiAuthTokenResponse>;
  now?: () => number;
  limiter?: GeminiPreviewRateLimiter;
}

function json(status: number, body: Record<string, string>): TrackerVoiceGeminiUatResponse {
  return { status, body };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function upstreamTokenError(status: number): string {
  if (status === 400) return "gemini_ephemeral_token_invalid_request";
  if (status === 401 || status === 403) return "gemini_ephemeral_token_unauthorized";
  if (status === 429) return "gemini_ephemeral_token_rate_limited";
  return "gemini_ephemeral_token_unavailable";
}

export function buildGeminiAuthTokenRequest(now: number): Record<string, unknown> {
  return {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    expireTime: new Date(now + (20 * 60_000)).toISOString(),
    liveConnectConstraints: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      config: {
        sessionResumption: {},
        responseModalities: ["AUDIO"],
      },
    },
  };
}

function isProvisioningError(error: unknown): error is GeminiProvisioningError {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && typeof error.status === "number";
}

async function createGeminiAuthToken(
  environment: TrackerVoiceGeminiUatEnvironment,
  now: number,
): Promise<GeminiAuthTokenResponse> {
  const response = await fetch(`https://generativelanguage.googleapis.com/${GEMINI_LIVE_API_VERSION}/auth_tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": environment.GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify(buildGeminiAuthTokenRequest(now)),
  });
  if (!response.ok) throw { status: response.status } satisfies GeminiProvisioningError;
  return response.json() as Promise<GeminiAuthTokenResponse>;
}

export class GeminiPreviewRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  allow(key: string, now: number): boolean {
    const cutoff = now - RATE_WINDOW_MS;
    const recent = (this.attempts.get(key) ?? []).filter((attempt) => attempt > cutoff);
    if (recent.length >= MAX_REQUESTS_PER_MINUTE) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > MAX_RATE_LIMIT_KEYS) {
      const oldest = this.attempts.keys().next().value;
      if (typeof oldest === "string") this.attempts.delete(oldest);
    }
    return true;
  }
}

export function isTrackerVoiceGeminiPreview(environment: TrackerVoiceGeminiUatEnvironment): boolean {
  return environment.VERCEL_ENV === "preview" && environment.TRACKER_VOICE_UAT_ENABLED === "true";
}

export async function createTrackerVoiceGeminiCredential(
  environment: TrackerVoiceGeminiUatEnvironment,
  request: TrackerVoiceGeminiUatRequest,
  dependencies: TrackerVoiceGeminiUatDependencies = {},
): Promise<TrackerVoiceGeminiUatResponse> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isTrackerVoiceGeminiPreview(environment)) return json(404, { error: "preview_uat_disabled" });
  if (!environment.GEMINI_API_KEY) return json(503, { error: "gemini_preview_secret_missing" });

  const now = dependencies.now?.() ?? Date.now();
  const clientKey = hash(request.clientIp || "unknown");
  const limiter = dependencies.limiter ?? defaultRateLimiter;
  if (!limiter.allow(clientKey, now)) return json(429, { error: "preview_uat_rate_limited" });

  let payload: GeminiAuthTokenResponse;
  try {
    payload = await (dependencies.tokenCreator ?? createGeminiAuthToken)(environment, now);
  } catch (error) {
    const status = isProvisioningError(error) ? error.status : 0;
    return json(502, { error: upstreamTokenError(status) });
  }
  if (typeof payload.name !== "string" || payload.name.length === 0 || payload.name.length > 4_096 || !isIsoDate(payload.expireTime)) {
    return json(502, { error: "gemini_ephemeral_token_unavailable" });
  }

  // The permanent key stays on the Vercel Preview function. The browser gets only this restricted token.
  return json(200, {
    ephemeral_token: payload.name,
    expires_at: new Date(payload.expireTime).toISOString(),
    model: GEMINI_LIVE_MODEL,
  });
}

const defaultRateLimiter = new GeminiPreviewRateLimiter();

function requestIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim().slice(0, 128) || request.socket.remoteAddress || "unknown";
}

function send(response: ServerResponse, result: TrackerVoiceGeminiUatResponse): void {
  response.statusCode = result.status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(result.body));
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const environment: TrackerVoiceGeminiUatEnvironment = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    TRACKER_VOICE_UAT_ENABLED: process.env.TRACKER_VOICE_UAT_ENABLED,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  const result = await createTrackerVoiceGeminiCredential(environment, {
    method: request.method,
    clientIp: requestIp(request),
  });
  send(response, result);
}
