// LeaderboardPanel now reads the get_tournament_leaderboard RPC directly (no Edge
// Function hop) + subscribes to chip realtime. This pins the RPC-driven render and
// that no Edge Function is invoked (the source of "Failed to send a request…").
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { invokeSpy, MOCK_LB } = vi.hoisted(() => ({
  invokeSpy: vi.fn(),
  MOCK_LB: {
    players_remaining: 9, itm_places: 5, average_stack: 100000, prize_pool: 5000000,
    players: [
      { player_id: "p1", entry_number: 1, player_name: "Alice", chip_count: 250000, position: null, is_itm: false, prize: null },
      { player_id: "p2", entry_number: 1, player_name: "Bob", chip_count: 50000, position: null, is_itm: false, prize: null },
    ],
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve(name === "get_tournament_leaderboard" ? { data: MOCK_LB, error: null } : { data: null, error: null }),
    functions: { invoke: invokeSpy }, // must NOT be called
    channel: () => { const ch: any = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel: () => {},
  },
}));

// eslint-disable-next-line import/first
import { LeaderboardPanel } from "@/components/cashier/tournament-live/LeaderboardPanel";

afterEach(() => cleanup());

describe("LeaderboardPanel", () => {
  it("renders ranked players from the RPC and never calls an Edge Function", async () => {
    render(<LeaderboardPanel tournamentId="t1" />);
    expect((await screen.findAllByText("Alice")).length).toBeGreaterThan(0); // mobile card + desktop row
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
