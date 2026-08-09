import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SeriesClubLivePulseV1 } from "./seriesClubLivePulseV1";
import { useSeriesClubLivePulseV1 } from "./useSeriesClubLivePulseV1";

vi.mock("./seriesClubLivePulseRpc", () => ({ getSeriesClubLivePulseV1: vi.fn() }));

const CLUB_ID = "11111111-1111-4111-8111-111111111111";
const PULSE = { version: "series-club-live-pulse-v1", clubId: CLUB_ID } as SeriesClubLivePulseV1;

describe("useSeriesClubLivePulseV1", () => {
  it("stays disabled without invoking the loader", () => {
    const load = vi.fn();
    const { result } = renderHook(() => useSeriesClubLivePulseV1({ enabled: false, clubId: CLUB_ID, load }));
    expect(result.current.state).toBe("disabled");
    expect(load).not.toHaveBeenCalled();
  });

  it("moves loading to ready and refreshes only on explicit action", async () => {
    let release: ((value: { ok: true; value: SeriesClubLivePulseV1 }) => void) | undefined;
    const load = vi.fn(() => new Promise<{ ok: true; value: SeriesClubLivePulseV1 }>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
    expect(result.current.state).toBe("loading");

    await act(async () => release?.({ ok: true, value: PULSE }));
    expect(result.current.state).toBe("ready");
    expect(result.current.pulse).toBe(PULSE);
    expect(load).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    expect(result.current.state).toBe("refreshing");
    await act(async () => release?.({ ok: true, value: PULSE }));
    expect(result.current.state).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a missing club and an RPC authorization error", async () => {
    const missing = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: null }));
    expect(missing.result.current).toMatchObject({ state: "unavailable", pulse: null, error: "club_unavailable" });

    const load = vi.fn().mockResolvedValue({ ok: false, error: "forbidden", retryable: false });
    const denied = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
    await waitFor(() => expect(denied.result.current.state).toBe("unavailable"));
    expect(denied.result.current).toMatchObject({ pulse: null, error: "forbidden", retryable: false });
  });
});
