import { describe, expect, it, vi } from "vitest";
import { createSeriesCopilotHandlerV1 } from "./handler";
import { createProcessLocalRateLimiterV1 } from "./rateLimiter";
import type { SeriesCopilotProvider } from "./provider";
import { inputs, validResponse } from "./contracts.test";
import { AS_OF, CLUB_ID, pulse } from "./serverContext.test";

const ENV = { supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "anon-test", geminiApiKey: "server-test-key", geminiModel: "gemini-test-001" };
const AUTH = { Authorization: "Bearer user-test-token", "Content-Type": "application/json" };
type FetchCall = [input: RequestInfo | URL, init?: RequestInit];
interface FetchSpy { mock: { calls: FetchCall[] } }

function request(body: unknown, headers: Record<string, string> = AUTH) {
  return new Request("http://local/series-intelligence-copilot", { method: "POST", headers, body: JSON.stringify(body) });
}
function body(selectedOptionIds: string[] = ["option_a"]) { return { version: "series-v-request-v1", clubId: CLUB_ID, question: "Nên chọn lịch nào?", selectedOptionIds }; }

function sourceFetch(pulseStatus = 200): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "owner-user-id" }), { status: 200 });
    if (url.endsWith("/rest/v1/rpc/get_series_club_live_pulse_v1")) return new Response(JSON.stringify(pulse()), { status: pulseStatus });
    throw new Error("unexpected network call");
  }) as unknown as typeof fetch;
}

const provider: SeriesCopilotProvider = {
  ask: vi.fn(async ({ context }) => ({
    response: { ...validResponse(), answerStatus: "limited" as const },
    receipt: {
      provider: "gemini" as const, modelId: "gemini-test-001", contextHash: context.contextHash,
      promptContractVersion: "series-v-prompt-policy-v1" as const, responseContractVersion: "series-v-response-v1" as const,
      validatorVersion: "series-v-edge-validator-v1" as const, latencyMs: 1, inputTokens: 1, outputTokens: 1,
      validationState: "accepted" as const, rateLimitScope: "process_local_prototype" as const,
    },
  })),
};

describe("series-intelligence-copilot handler", () => {
  it("authenticates, authorizes through the user-context RPC, and returns validated output", async () => {
    const fetchImpl = sourceFetch();
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl, providerFactory: () => provider, scheduleSource: async () => inputs });
    const response = await handler(request(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ response: { version: "series-v-response-v1" }, receipt: { provider: "gemini" } });
    const calls = (fetchImpl as unknown as FetchSpy).mock.calls;
    expect(calls[1][1].headers.Authorization).toBe(AUTH.Authorization);
    expect(calls[1][1].body).toContain(CLUB_ID);
    expect(calls[1][1]).not.toHaveProperty("serviceRoleKey");
  });

  it("fails cross-club RPC authorization closed", async () => {
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(403), providerFactory: () => provider, scheduleSource: async () => inputs });
    expect((await handler(request(body()))).status).toBe(403);
  });

  it("does not call Gemini when approved candidates are unavailable", async () => {
    const blockedProvider = { ask: vi.fn() } as unknown as SeriesCopilotProvider;
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => blockedProvider });
    const response = await handler(request(body([])));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reason: "APPROVED_SCHEDULE_CANDIDATES_UNAVAILABLE", response: { answerStatus: "blocked" } });
    expect(blockedProvider.ask).not.toHaveBeenCalled();
  });

  it("rejects browser-supplied metrics and missing auth", async () => {
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => provider, scheduleSource: async () => inputs });
    expect((await handler(request({ ...body(), entriesToday: 99 }))).status).toBe(400);
    expect((await handler(request(body(), { "Content-Type": "application/json" }))).status).toBe(401);
  });

  it("enforces a user/club scoped process-local prototype limit", async () => {
    const handler = createSeriesCopilotHandlerV1({
      env: ENV, fetchImpl: sourceFetch(), providerFactory: () => provider, scheduleSource: async () => inputs,
      rateLimiter: createProcessLocalRateLimiterV1(1, 60_000),
    });
    expect((await handler(request(body()))).status).toBe(200);
    const limited = await handler(request(body()));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ rateLimitScope: "process_local_prototype" });
  });

  it("does not include question, JWT, or Club Pulse in safe logs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => provider, scheduleSource: async () => inputs });
    await handler(request({ ...body(), question: "secret-looking owner question" }));
    const output = String(log.mock.calls[0][0]);
    expect(output).not.toContain("secret-looking");
    expect(output).not.toContain("user-test-token");
    expect(output).not.toContain(AS_OF);
    log.mockRestore();
  });

  it("fails a provider exception closed without exposing its message", async () => {
    const failingProvider: SeriesCopilotProvider = { ask: vi.fn(async () => { throw new Error("private provider detail"); }) };
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => failingProvider, scheduleSource: async () => inputs });
    const response = await handler(request(body()));
    expect(response.status).toBe(503);
    const output = await response.text();
    expect(output).toContain("PROVIDER_UNAVAILABLE");
    expect(output).not.toContain("private provider detail");
  });
});
