import { blockedVResponseV1, parseSeriesVRequestV1, type SafeProviderReceiptV1 } from "./contracts.ts";
import { GeminiSeriesCopilotProvider } from "./geminiProvider.ts";
import { SeriesCopilotProviderError, type SeriesCopilotProvider } from "./provider.ts";
import { createProcessLocalRateLimiterV1, type ProcessLocalRateLimiterV1 } from "./rateLimiter.ts";
import { buildServerCopilotContextV1, unavailableScheduleInputsV1, type ApprovedScheduleInputsV1 } from "./serverContext.ts";

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
  rateLimiter?: ProcessLocalRateLimiterV1;
}

interface AuthenticatedUser {
  id: string;
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

function providerStatus(error: SeriesCopilotProviderError): number {
  if (error.code === "PROVIDER_NOT_CONFIGURED") return 503;
  if (error.code === "PROVIDER_RATE_LIMITED") return 429;
  if (error.code === "PROVIDER_RESPONSE_REJECTED") return 502;
  if (error.code === "PROVIDER_TIMEOUT") return 504;
  return 503;
}

export function createSeriesCopilotHandlerV1(options: CreateSeriesCopilotHandlerV1Options): (request: Request) => Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rateLimiter = options.rateLimiter ?? createProcessLocalRateLimiterV1();
  const scheduleSource = options.scheduleSource ?? (async () => unavailableScheduleInputsV1());
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
    const user = await authenticate(fetchImpl, options.env, authHeader);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);
    let parsed;
    try {
      parsed = parseSeriesVRequestV1(await request.json());
    } catch {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    if (!rateLimiter.consume(`${user.id}:${parsed.clubId}`)) return json({ error: "RATE_LIMITED", rateLimitScope: rateLimiter.scope }, 429);
    const pulse = await loadOwnerPulse(fetchImpl, options.env, authHeader, parsed.clubId);
    if (pulse.status === 401) return json({ error: "UNAUTHORIZED" }, 401);
    if (pulse.status === 403 || pulse.status === 404) return json({ error: "FORBIDDEN" }, 403);
    if (pulse.status !== 200) return json({ error: "CLUB_PULSE_UNAVAILABLE" }, 503);
    let context;
    try {
      const scheduleInputs = await scheduleSource(parsed.clubId, parsed.selectedOptionIds);
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
