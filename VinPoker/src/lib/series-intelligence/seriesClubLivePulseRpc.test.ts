import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERIES_CLUB_PULSE_METRIC_DEFINITIONS, type SeriesClubPulseMetricKey } from "./seriesClubLivePulseV1";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { getSeriesClubLivePulseV1 } from "./seriesClubLivePulseRpc";

const AS_OF = "2026-08-09T12:34:56.789Z";
const CLUB_ID = "11111111-1111-4111-8111-111111111111";
const LEGACY_CLUB_ID = "22222222-2222-2222-2222-222222222222";

function metric(key: SeriesClubPulseMetricKey, value: number) {
  return {
    ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
    value,
    unit: "count",
    availability: "exact",
    privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe",
    asOf: AS_OF,
  };
}

function payload(clubId = CLUB_ID) {
  return {
    version: "series-club-live-pulse-v1",
    clubId,
    asOf: AS_OF,
    clubLocalDate: "2026-08-09",
    timezone: "Asia/Ho_Chi_Minh",
    clubMemberProfiles: metric("clubMemberProfiles", 12),
    uniquePlayersToday: metric("uniquePlayersToday", 5),
    entriesToday: metric("entriesToday", 7),
    playersPlayingNow: metric("playersPlayingNow", 5),
    runningEvents: metric("runningEvents", 1),
    openTables: metric("openTables", 4),
    dealersOnDuty: metric("dealersOnDuty", 5),
    dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] },
  };
}

describe("Series Club Pulse fixed RPC adapter", () => {
  beforeEach(() => rpc.mockReset());

  it("calls only the owner-scoped aggregate RPC with the exact named argument", async () => {
    rpc.mockResolvedValue({ data: payload(), error: null });
    await expect(getSeriesClubLivePulseV1(CLUB_ID)).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_series_club_live_pulse_v1", { p_club_id: CLUB_ID });
  });

  it("rejects a malformed club id before touching the network", async () => {
    await expect(getSeriesClubLivePulseV1("not-a-club")).resolves.toEqual({ ok: false, error: "invalid_club_id", retryable: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a legacy PostgreSQL UUID without RFC version bits", async () => {
    rpc.mockResolvedValue({ data: payload(LEGACY_CLUB_ID), error: null });
    await expect(getSeriesClubLivePulseV1(LEGACY_CLUB_ID)).resolves.toMatchObject({
      ok: true,
      value: { clubId: LEGACY_CLUB_ID },
    });
    expect(rpc).toHaveBeenCalledWith("get_series_club_live_pulse_v1", { p_club_id: LEGACY_CLUB_ID });
  });

  it("fails closed on malformed aggregate payloads", async () => {
    rpc.mockResolvedValue({ data: { ...payload(), entriesToday: { value: 7 } }, error: null });
    await expect(getSeriesClubLivePulseV1(CLUB_ID)).resolves.toEqual({ ok: false, error: "malformed_response", retryable: false });
  });

  it.each([
    [{ code: "42501", message: "forbidden" }, { ok: false, error: "forbidden", retryable: false }],
    [{ code: "PGRST202", message: "Could not find function" }, { ok: false, error: "backend_unavailable", retryable: false }],
    [{ status: 503, message: "gateway unavailable" }, { ok: false, error: "rpc_error", retryable: true }],
  ])("classifies RPC failure %#", async (error, expected) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(getSeriesClubLivePulseV1(CLUB_ID)).resolves.toEqual(expected);
  });
});
