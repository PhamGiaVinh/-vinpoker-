import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const MODEL = "gpt-live-transcribe";
const MAX_REQUESTS_PER_MINUTE = 6;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 512;

export interface TrackerVoiceUatEnvironment {
  VERCEL_ENV?: string;
  TRACKER_VOICE_UAT_ENABLED?: string;
  OPENAI_API_KEY?: string;
}

export interface TrackerVoiceUatRequest {
  method?: string;
  clientIp: string;
}

export interface TrackerVoiceUatResponse {
  status: number;
  body: Record<string, string>;
}

interface OpenAiClientSecretResponse {
  value?: unknown;
  expires_at?: unknown;
  client_secret?: {
    value?: unknown;
    expires_at?: unknown;
  };
}

interface TrackerVoiceUatDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
  limiter?: PreviewVoiceRateLimiter;
}

function json(status: number, body: Record<string, string>): TrackerVoiceUatResponse {
  return { status, body };
}

function normalizeExpiry(value: unknown): string | null {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  return null;
}

function normalizeClientSecret(payload: OpenAiClientSecretResponse): { clientSecret: string; expiresAt: string } | null {
  const clientSecret = typeof payload.value === "string"
    ? payload.value
    : typeof payload.client_secret?.value === "string"
      ? payload.client_secret.value
      : null;
  const expiresAt = normalizeExpiry(payload.expires_at ?? payload.client_secret?.expires_at);
  return clientSecret && expiresAt ? { clientSecret, expiresAt } : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildSessionRequestBody(): string {
  return JSON.stringify({
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: MODEL,
            prompt: "Vietnamese and English poker tournament dealer actions and chip amounts.",
            keywords: [
              "fold",
              "check",
              "call",
              "bet",
              "raise",
              "all-in",
              "bỏ bài",
              "theo",
              "cược",
              "tố",
              "tất tay",
              "báo sai",
              "gọi Floor",
            ],
            languages: ["vi", "en"],
            delay: "low",
          },
          // gpt-live-transcribe supports server VAD, so dealer turns complete
          // without the browser manually committing an audio buffer.
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  });
}

export class PreviewVoiceRateLimiter {
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
      const oldestKey = this.attempts.keys().next().value;
      if (typeof oldestKey === "string") this.attempts.delete(oldestKey);
    }
    return true;
  }
}

export function isTrackerVoiceUatPreview(environment: TrackerVoiceUatEnvironment): boolean {
  return environment.VERCEL_ENV === "preview" && environment.TRACKER_VOICE_UAT_ENABLED === "true";
}

export async function createTrackerVoiceUatCredential(
  environment: TrackerVoiceUatEnvironment,
  request: TrackerVoiceUatRequest,
  dependencies: TrackerVoiceUatDependencies = {},
): Promise<TrackerVoiceUatResponse> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isTrackerVoiceUatPreview(environment)) return json(404, { error: "preview_uat_disabled" });
  if (!environment.OPENAI_API_KEY) return json(503, { error: "preview_openai_secret_missing" });

  const clientKey = hash(request.clientIp || "unknown");
  const limiter = dependencies.limiter ?? defaultRateLimiter;
  const now = dependencies.now?.() ?? Date.now();
  if (!limiter.allow(clientKey, now)) return json(429, { error: "preview_uat_rate_limited" });

  let response: Response;
  try {
    response = await (dependencies.fetcher ?? fetch)("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        // A hash is stable for this protected Preview requester but does not expose an IP.
        "OpenAI-Safety-Identifier": `tracker-voice-uat:${clientKey}`,
      },
      body: buildSessionRequestBody(),
    });
  } catch {
    return json(502, { error: "openai_realtime_session_unavailable" });
  }
  if (!response.ok) return json(502, { error: "openai_realtime_session_unavailable" });

  let payload: OpenAiClientSecretResponse;
  try {
    payload = await response.json() as OpenAiClientSecretResponse;
  } catch {
    return json(502, { error: "openai_realtime_session_unavailable" });
  }
  const credential = normalizeClientSecret(payload);
  if (!credential) return json(502, { error: "openai_realtime_session_unavailable" });

  // The browser receives only this short-lived credential; the standard key stays server-side.
  return json(200, {
    client_secret: credential.clientSecret,
    model: MODEL,
    expires_at: credential.expiresAt,
  });
}

const defaultRateLimiter = new PreviewVoiceRateLimiter();

function requestIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim().slice(0, 128) || request.socket.remoteAddress || "unknown";
}

function send(response: ServerResponse, result: TrackerVoiceUatResponse): void {
  response.statusCode = result.status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(result.body));
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const environment: TrackerVoiceUatEnvironment = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    TRACKER_VOICE_UAT_ENABLED: process.env.TRACKER_VOICE_UAT_ENABLED,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const result = await createTrackerVoiceUatCredential(environment, {
    method: request.method,
    clientIp: requestIp(request),
  });
  send(response, result);
}
