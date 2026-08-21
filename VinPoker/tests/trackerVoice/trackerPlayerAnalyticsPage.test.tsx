import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  featureEnabled: true,
  auth: { user: { id: "user-1" }, loading: false },
  load: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/featureFlags", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/featureFlags")>();
  return {
    ...actual,
    FEATURES: new Proxy(actual.FEATURES, {
      get(target, property) {
        if (property === "trackerPlayerAnalytics") return state.featureEnabled;
        return Reflect.get(target, property);
      },
    }),
  };
});
vi.mock("@/lib/trackerVoice", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/trackerVoice")>();
  return { ...actual, loadTrackerPlayerAnalytics: state.load };
});
import TrackerPlayerAnalytics from "@/pages/TrackerPlayerAnalytics";

const TOURNAMENT_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";

function response() {
  const keys = ["vpip", "pfr", "threeBet", "foldToThreeBet", "fourBet", "fiveBet", "wtsd", "wsd", "wwsf", "flopCbet", "turnCbet", "foldToCbet", "checkRaise", "aggressionFrequency"];
  return {
    ok: true,
    player: { id: PLAYER_ID, name: "Player A", avatar_url: null },
    tournament_id: TOURNAMENT_ID,
    days: 90,
    truncated: false,
    analytics: {
      metricVersion: "tracker-player-analytics-v0",
      handsObserved: 20,
      proofCoverage: { verified: 8, required: 10 },
      unavailableMetrics: ["wsd"],
      metrics: Object.fromEntries(keys.map((key) => [key, {
        numerator: key === "wsd" ? 0 : 5,
        denominator: key === "wsd" ? 0 : 10,
        percentage: key === "wsd" ? null : 50,
        sampleSize: key === "wsd" ? 0 : 10,
        metricVersion: "tracker-player-analytics-v0",
      }])),
    },
  };
}

function renderPage(path = `/tracker/player/${PLAYER_ID}/analytics?t=${TOURNAMENT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tracker/player/:playerId/analytics" element={<TrackerPlayerAnalytics />} />
        <Route path="/tracker" element={<div>TRACKER_HOME</div>} />
        <Route path="/tracker/hand-input" element={<div>HAND_INPUT</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.featureEnabled = true;
  state.auth.user = { id: "user-1" };
  state.auth.loading = false;
  state.load.mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tracker player analytics ops route", () => {
  it("fails closed for an invalid explicit scope without invoking Edge", () => {
    renderPage("/tracker/player/not-a-uuid/analytics?t=bad");
    expect(screen.getByRole("alert")).toHaveTextContent("Scope phân tích không hợp lệ");
    expect(state.load).not.toHaveBeenCalled();
  });

  it("renders aggregate metrics and keeps unavailable settlement metrics explicit", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Player A" })).toBeInTheDocument();
    expect(state.load).toHaveBeenCalledWith({ tournamentId: TOURNAMENT_ID, playerId: PLAYER_ID, days: 90 });
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("8/10 hand có settlement proof")).toBeInTheDocument();
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("Chưa đủ proof")).toBeInTheDocument();
  });

  it("changes the time window and ignores public or implicit tournament fallback", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Player A" });
    fireEvent.click(screen.getByRole("button", { name: "30 ngày" }));
    await waitFor(() => expect(state.load).toHaveBeenLastCalledWith({ tournamentId: TOURNAMENT_ID, playerId: PLAYER_ID, days: 30 }));
  });

  it("unmounts the route when the source flag is off", () => {
    state.featureEnabled = false;
    renderPage();
    expect(screen.getByText("TRACKER_HOME")).toBeInTheDocument();
    expect(state.load).not.toHaveBeenCalled();
  });

  it("restores only a tracker-scoped return path", async () => {
    const returnTo = encodeURIComponent("/tracker/hand-input?t=abc&hand=4");
    renderPage(`/tracker/player/${PLAYER_ID}/analytics?t=${TOURNAMENT_ID}&returnTo=${returnTo}`);
    await screen.findByRole("heading", { name: "Player A" });
    fireEvent.click(screen.getByRole("button", { name: "Quay lại bàn" }));
    expect(screen.getByText("HAND_INPUT")).toBeInTheDocument();
  });
});
