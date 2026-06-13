// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Spy on the edge-function call and control the kill-switch flag per test.
const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tdAiRemote: false } }));

import { useTdAi } from "./useTdAi";
import { FEATURES } from "@/lib/featureFlags";

const SITUATION = { description: "khách đặt cược chuỗi nhiều lần" };
const setRemote = (on: boolean) => {
  (FEATURES as { tdAiRemote: boolean }).tdAiRemote = on;
};

beforeEach(() => {
  invokeMock.mockReset();
  setRemote(false);
});

describe("useTdAi — remote AI kill switch", () => {
  it("OFF (default): NEVER calls the edge function, answers from local lookup", async () => {
    const { result } = renderHook(() => useTdAi());
    await act(async () => {
      await result.current.ask(SITUATION);
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.answer?.source).toBe("local");
    expect(result.current.answer?.isDemo).toBe(true);
  });

  it("ON: calls the edge function and uses its answer", async () => {
    setRemote(true);
    invokeMock.mockResolvedValue({
      data: {
        source: "ai", isDemo: false, recommendationVi: "ok", citations: [],
        reasoningVi: "", houseRuleOptionVi: "", playerWordingVi: "",
        confidence: "medium", needMoreInfoVi: [], matchedRuleIds: [],
      },
      error: null,
    });
    const { result } = renderHook(() => useTdAi());
    await act(async () => {
      await result.current.ask(SITUATION);
    });
    expect(invokeMock).toHaveBeenCalledWith("td-ai-assistant", { body: SITUATION });
    expect(result.current.answer?.source).toBe("ai");
  });

  it("ON but edge fails: falls back to local lookup", async () => {
    setRemote(true);
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useTdAi());
    await act(async () => {
      await result.current.ask(SITUATION);
    });
    expect(invokeMock).toHaveBeenCalled();
    expect(result.current.answer?.source).toBe("local");
  });
});
