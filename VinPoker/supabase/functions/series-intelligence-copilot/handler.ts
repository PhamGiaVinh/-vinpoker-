import { blockedVResponseV1, parseSeriesVRequestV1, type SafeProviderReceiptV1 } from "./contracts.ts";
import { GeminiSeriesCopilotProvider } from "./geminiProvider.ts";
import { SeriesCopilotProviderError, type SeriesCopilotProvider } from "./provider.ts";
import { buildServerCopilotContextV1, parseApprovedScheduleInputsV1, type ApprovedScheduleInputsV1 } from "./serverContext.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface SeriesCopilotEnvironmentV1 {
  supabaseUrl: string;
  supabaseAnonKey: string;
  geminiApiKey: string;
  geminiModel: string;
}

export interface CreateSeriesCopilotHandlerV1Options {
  env: SeriesCopilotEnvironmentV1;
  fetchImpl?: typeof fetch;
  providerFactory?: (env: SeriesCopilotEnvironmentV1, fetchImpl: typeof fetch) => SeriesCopilotProvider;
  scheduleSource?: (clubId: string, selectedOptionIds: readonly string[]) => Promise<ApprovedScheduleInputsV1>;
  rateLimitSource?: (clubId: string, requestId: string) => Promise<DurableRateLimitResultV1>;
}

interface AuthenticatedUser {
  id: string;
}

interface DurableRateLimitResultV1 {
  version: "series-v-rate-policy-v1";
  allowed: boolean;
  retryAfterSeconds: number;
  limitScope: "actor_club_global";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function authenticate(fetchImpl: typeof fetch, env: SeriesCopilotEnvironmentV1, authHeader: string): Promise<AuthenticatedUser | null> {
  const response = await fetchImpl(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: env.supabaseAnonKey },
  });
  if (!response.ok) return null;
  const raw = await response.json() as Record<string, unknown>;
  return typeof raw.id === "string" ? { id: raw.id } : null;
}

async function loadOwnerPulse(fetchImpl: typeof fetch, env: SeriesCopilotEnvironmentV1, authHeader: string, clubId: string): Promise<{ status: number; value?: unknown }> {
  const response = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/get_series_club_live_pulse_v1`, {
    method: "POST",
    headers: { Authorization: authHeader, apikey: env.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_club_id: clubId }),
  });
  if (!response.ok) return { status: response.status };
  return { status: 200, value: await response.json() };
}

async function callRpc(fetchImpl: typeof fetch, env: SeriesCopilotEnvironmentV1, authHeader: string, name: string, body: unknown): Promise<{ status: number; value?: unknown }> {
  const response = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: authHeader, apikey: env.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { status: response.status };
  return { status: 200, value: await response.json() };
}

function parseRateLimitResult(raw: unknown): DurableRateLimitResultV1 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("rate limit result is invalid");
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "allowed,limitScope,retryAfterSeconds,version") throw new Error("rate limit result keys are invalid");
  if (value.version !== "series-v-rate-policy-v1" || value.limitScope !== "actor_club_global" || typeof value.allowed !== "boolean") throw new Error("rate limit result identity is invalid");
  if (!Number.isSafeInteger(value.retryAfterSeconds) || (value.retryAfterSeconds as number) < 0 || (value.retryAfterSeconds as number) > 3600) throw new Error("rate limit retry is invalid");
  return Object.freeze({
    version: "series-v-rate-policy-v1",
    allowed: value.allowed,
    retryAfterSeconds: value.retryAfterSeconds as number,
    limitScope: "actor_club_global",
  });
}

function providerStatus(error: SeriesCopilotProviderError): number {
  if (error.code === "PROVIDER_NOT_CONFIGURED") return 503;
  if (error.code === "PROVIDER_RATE_LIMITED") return 429;
  if (error.code === "PROVIDER_RESPONSE_REJECTED") return 502;
  if (error.code === "PROVIDER_TIMEOUT") return 504;
  return 503;
}

export function createSeriesCopilotHandlerV1(options: CreateSeriesCopilotHandlerV1Options): (request: Request) => Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    let parsed;
    try {
      parsed = parseSeriesVRequestV1(await request.json());
    } catch {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
    const user = await authenticate(fetchImpl, options.env, authHeader);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);
    let rateLimit: DurableRateLimitResultV1;
    try {
      if (options.rateLimitSource) {
        rateLimit = await options.rateLimitSource(parsed.clubId, parsed.requestId);
      } else {
        const result = await callRpc(fetchImpl, options.env, authHeader, "series_consume_copilot_rate_limit_v1", { p_club_id: parsed.clubId, p_request_id: parsed.requestId });
        if (result.status === 401) return json({ error: "UNAUTHORIZED" }, 401);
        if (result.status === 403 || result.status === 404) return json({ error: "FORBIDDEN" }, 403);
        if (result.status !== 200) return json({ error: "RATE_LIMIT_UNAVAILABLE" }, 503);
        rateLimit = parseRateLimitResult(result.value);
      }
    } catch {
      return json({ error: "RATE_LIMIT_UNAVAILABLE" }, 503);
    }
    if (!rateLimit.allowed) return json({ error: "RATE_LIMITED", retryAfterSeconds: rateLimit.retryAfterSeconds }, 429);
    const pulse = await loadOwnerPulse(fetchImpl, options.env, authHeader, parsed.clubId);
    if (pulse.status === 401) return json({ error: "UNAUTHORIZED" }, 401);
    if (pulse.status === 403 || pulse.status === 404) return json({ error: "FORBIDDEN" }, 403);
    if (pulse.status !== 200) return json({ error: "CLUB_PULSE_UNAVAILABLE" }, 503);
    let context;
    try {
      let scheduleInputs: ApprovedScheduleInputsV1;
      if (options.scheduleSource) {
        scheduleInputs = await options.scheduleSource(parsed.clubId, parsed.selectedOptionIds);
      } else {
        const source = await callRpc(fetchImpl, options.env, authHeader, "series_get_approved_schedule_candidates_v1", {
          p_club_id: parsed.clubId,
          p_option_ids: parsed.selectedOptionIds.length === 0 ? null : parsed.selectedOptionIds,
        });
        if (source.status !== 200) throw new Error("approved candidates unavailable");
        scheduleInputs = parseApprovedScheduleInputsV1(source.value, parsed.clubId);
      }
      context = await buildServerCopilotContextV1(pulse.value, parsed.clubId, scheduleInputs);
      for (const selected of parsed.selectedOptionIds) {
        if (!context.candidateOptions.some((option) => option.optionId === selected)) return json({ error: "UNKNOWN_SELECTED_OPTION" }, 400);
      }
      if (context.candidateOptions.length === 0) {
        return json({ response: blockedVResponseV1(), contextHash: context.contextHash, reason: "APPROVED_SCHEDULE_CANDIDATES_UNAVAILABLE" }, 200);
      }
    } catch {
      return json({ error: "COPILOT_CONTEXT_REJECTED" }, 503);
    }
    try {
      const provider = options.providerFactory
        ? options.providerFactory(options.env, fetchImpl)
        : new GeminiSeriesCopilotProvider({ apiKey: options.env.geminiApiKey, modelId: options.env.geminiModel, fetchImpl });
      const result = await provider.ask({ question: parsed.question, context, selectedOptionIds: parsed.selectedOptionIds, signal: request.signal });
      const receipt: SafeProviderReceiptV1 = result.receipt;
      console.info(JSON.stringify({ event: "series_v_provider_receipt", ...receipt }));
      return json({ response: result.response, receipt });
    } catch (error) {
      if (error instanceof SeriesCopilotProviderError) {
        return json({ error: error.code }, providerStatus(error));
      }
      return json({ error: "PROVIDER_UNAVAILABLE" }, 503);
    }
  };
}
