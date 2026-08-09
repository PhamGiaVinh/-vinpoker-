import { describe, expect, it, vi } from "vitest";
import { createSeriesCopilotHandlerV1 } from "./handler";
import type { SeriesCopilotProvider } from "./provider";
import { inputs, validResponse } from "./contracts.test";
import { AS_OF, CLUB_ID, pulse } from "./serverContext.test";

const ENV = { supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "anon-test", geminiApiKey: "server-test-key" };
const AUTH = { Authorization: "Bearer user-test-token", "Content-Type": "application/json" };
type FetchCall = [input: RequestInfo | URL, init?: RequestInit];
interface FetchSpy { mock: { calls: FetchCall[] } }

function request(body: unknown, headers: Record<string, string> = AUTH) {
  return new Request("http://local/series-intelligence-copilot", { method: "POST", headers, body: JSON.stringify(body) });
}
function body(selectedOptionIds: string[] = ["option_a"], requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") { return { version: "series-v-request-v1", requestId, clubId: CLUB_ID, question: "Nên chọn lịch nào?", selectedOptionIds }; }

const allowedRate = async () => ({ version: "series-v-rate-policy-v1" as const, allowed: true, retryAfterSeconds: 0, limitScope: "actor_club_global" as const });

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
      validationState: "accepted" as const, rateLimitScope: "actor_club_global" as const,
    },
  })),
};

describe("series-intelligence-copilot handler", () => {
  it("runs the default durable RPC path in the required order", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/v1/user")) {
        order.push("auth");
        return new Response(JSON.stringify({ id: "owner-user-id" }), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/series_consume_copilot_rate_limit_v1")) {
        order.push("rate");
        return new Response(JSON.stringify({ version: "series-v-rate-policy-v1", allowed: true, retryAfterSeconds: 0, limitScope: "actor_club_global" }), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/get_series_club_live_pulse_v1")) {
        order.push("pulse");
        return new Response(JSON.stringify(pulse()), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/series_get_approved_schedule_candidates_v1")) {
        order.push("candidates");
        return new Response(JSON.stringify({ version: "series-approved-schedule-candidates-v1", clubId: CLUB_ID, asOf: AS_OF, ...inputs }), { status: 200 });
      }
      throw new Error("unexpected network call");
    }) as unknown as typeof fetch;
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl, providerFactory: () => provider });
    expect((await handler(request(body()))).status).toBe(200);
    expect(order).toEqual(["auth", "rate", "pulse", "candidates"]);
    const calls = (fetchImpl as unknown as FetchSpy).mock.calls;
    expect(calls[1][1]?.body).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(calls[3][1]?.body).not.toContain("200000000");
  });

  it("authenticates, authorizes through the user-context RPC, and returns validated output", async () => {
    const fetchImpl = sourceFetch();
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl, providerFactory: () => provider, scheduleSource: async () => inputs, rateLimitSource: allowedRate });
    const response = await handler(request(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ response: { version: "series-v-response-v1" }, receipt: { provider: "gemini" } });
    const calls = (fetchImpl as unknown as FetchSpy).mock.calls;
    expect(calls[1][1].headers.Authorization).toBe(AUTH.Authorization);
    expect(calls[1][1].body).toContain(CLUB_ID);
    expect(calls[1][1]).not.toHaveProperty("serviceRoleKey");
  });

  it("fails cross-club RPC authorization closed", async () => {
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(403), providerFactory: () => provider, scheduleSource: async () => inputs, rateLimitSource: allowedRate });
    expect((await handler(request(body()))).status).toBe(403);
  });

  it("allows an evidence-only Gemini summary but no recommendation when approved candidates are unavailable", async () => {
    const evidenceOnlyProvider: SeriesCopilotProvider = { ask: vi.fn(async ({ context }) => ({
      response: {
        version: "series-v-response-v1",
        summaryVi: "Club Pulse is available but no schedule candidate is approved.",
        optionAssessments: [],
        recommendedOptionId: null,
        missingDataIds: ["gap_approved_schedule_candidates"],
        evidenceRefs: ["club_pulse_server"],
        answerStatus: "blocked",
        humanDecisionRequired: true,
      },
      receipt: {
        provider: "gemini", modelId: "gemini-test-001", contextHash: context.contextHash,
        promptContractVersion: "series-v-prompt-policy-v1", responseContractVersion: "series-v-response-v1",
        validatorVersion: "series-v-edge-validator-v1", latencyMs: 1, inputTokens: 1, outputTokens: 1,
        validationState: "accepted", rateLimitScope: "actor_club_global",
      },
    })) };
    const handler = createSeriesCopilotHandlerV1({
      env: ENV,
      fetchImpl: sourceFetch(),
      providerFactory: () => evidenceOnlyProvider,
      scheduleSource: async () => ({
        candidateOptions: [],
        evidence: [],
        dataGaps: [{
          dataGapId: "gap_approved_schedule_candidates",
          titleVi: "No approved schedule candidate",
          detailVi: "An owner-approved server-side candidate is required.",
          severity: "critical",
          blocksRecommendation: true,
          requiredSourceVi: "Approved server-side schedule candidate",
        }],
      }),
      rateLimitSource: allowedRate,
    });
    const response = await handler(request(body([])));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ context: { candidateOptions: [] }, response: { answerStatus: "blocked", recommendedOptionId: null } });
    expect(evidenceOnlyProvider.ask).toHaveBeenCalledTimes(1);
  });

  it("rejects browser-supplied metrics and missing auth", async () => {
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => provider, scheduleSource: async () => inputs, rateLimitSource: allowedRate });
    expect((await handler(request({ ...body(), entriesToday: 99 }))).status).toBe(400);
    expect((await handler(request(body(), { "Content-Type": "application/json" }))).status).toBe(401);
  });

  it("enforces the durable actor and club limit before context or provider work", async () => {
    const blockedProvider = { ask: vi.fn() } as unknown as SeriesCopilotProvider;
    const handler = createSeriesCopilotHandlerV1({
      env: ENV, fetchImpl: sourceFetch(), providerFactory: () => blockedProvider, scheduleSource: async () => inputs,
      rateLimitSource: async () => ({ version: "series-v-rate-policy-v1", allowed: false, retryAfterSeconds: 17, limitScope: "actor_club_global" }),
    });
    const limited = await handler(request(body()));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "RATE_LIMITED", retryAfterSeconds: 17 });
    expect(blockedProvider.ask).not.toHaveBeenCalled();
  });

  it("does not include question, JWT, or Club Pulse in safe logs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => provider, scheduleSource: async () => inputs, rateLimitSource: allowedRate });
    await handler(request({ ...body(), question: "secret-looking owner question" }));
    const output = String(log.mock.calls[0][0]);
    expect(output).not.toContain("secret-looking");
    expect(output).not.toContain("user-test-token");
    expect(output).not.toContain(AS_OF);
    log.mockRestore();
  });

  it("fails a provider exception closed without exposing its message", async () => {
    const failingProvider: SeriesCopilotProvider = { ask: vi.fn(async () => { throw new Error("private provider detail"); }) };
    const handler = createSeriesCopilotHandlerV1({ env: ENV, fetchImpl: sourceFetch(), providerFactory: () => failingProvider, scheduleSource: async () => inputs, rateLimitSource: allowedRate });
    const response = await handler(request(body()));
    expect(response.status).toBe(503);
    const output = await response.text();
    expect(output).toContain("PROVIDER_UNAVAILABLE");
    expect(output).not.toContain("private provider detail");
  });
});
