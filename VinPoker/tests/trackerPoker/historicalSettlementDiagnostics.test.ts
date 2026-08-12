import { describe, expect, it } from "vitest";
import { diagnoseHistoricalSettlementInvocation } from "@/lib/tracker-poker/historicalSettlementDiagnostics";

describe("historical settlement Edge diagnostics", () => {
  it.each([
    [403, "historical_preview_forbidden"],
    [404, "historical_preview_not_found"],
    [422, "historical_preview_verification_blocked"],
    [500, "historical_preview_server_failed"],
  ])("maps preview HTTP %i without collapsing it into a transport failure", async (httpStatus, code) => {
    const diagnostic = await diagnoseHistoricalSettlementInvocation({
      data: null,
      error: { context: { status: httpStatus } },
      mode: "preview",
      handId: "hand-10",
    });

    expect(diagnostic).toEqual({
      code,
      httpStatus,
      responseParsed: false,
      mode: "preview",
      handId: "hand-10",
    });
  });

  it("retains a safe public verifier code without exposing the response body", async () => {
    const diagnostic = await diagnoseHistoricalSettlementInvocation({
      data: { ok: false, code: "stored_ending_stack_mismatch", internal_trace: "never-retained" },
      error: { context: { status: 422 } },
      mode: "preview",
      handId: "hand-8",
    });

    expect(diagnostic).toEqual({
      code: "stored_ending_stack_mismatch",
      httpStatus: 422,
      responseParsed: true,
      mode: "preview",
      handId: "hand-8",
    });
    expect(diagnostic).not.toHaveProperty("internal_trace");
  });

  it("reads a public verifier code from the failed function response clone", async () => {
    const diagnostic = await diagnoseHistoricalSettlementInvocation({
      data: null,
      error: {
        context: {
          status: 422,
          clone: () => ({ json: async () => ({ ok: false, code: "incomplete_showdown_cards", internal_trace: "never-retained" }) }),
        },
      },
      mode: "preview",
      handId: "hand-10",
    });

    expect(diagnostic).toEqual({
      code: "incomplete_showdown_cards",
      httpStatus: 422,
      responseParsed: true,
      mode: "preview",
      handId: "hand-10",
    });
    expect(diagnostic).not.toHaveProperty("internal_trace");
  });

  it("keeps network failures separate from a parsed HTTP failure", async () => {
    await expect(diagnoseHistoricalSettlementInvocation({
      data: null,
      error: new Error("network unavailable"),
      mode: "preview",
      handId: "hand-10",
    })).resolves.toMatchObject({
      code: "historical_preview_transport_failed",
      httpStatus: null,
      responseParsed: false,
    });
  });
});
