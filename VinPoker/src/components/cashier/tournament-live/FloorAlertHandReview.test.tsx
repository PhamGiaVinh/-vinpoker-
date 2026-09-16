// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rows = {
  tournament_hands: { data: { hand_number: 12, status: "in_progress", community_cards: ["2d", "5h", "9c"], pot_size: 600000, table_id: "physical-5" }, error: null },
  hand_actions: { data: [{ id: "action-1", action_order: 1, street: "preflop", player_id: "player-4", entry_number: 1, action_type: "call", action_amount: 200000 }], error: null },
  hand_players: { data: [{ player_id: "player-4", entry_number: 1, seat_number: 4 }], error: null },
};

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  useSupabaseClient: () => client,
}));

const client = {
    from: (table: keyof typeof rows) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => rows[table],
        then: (resolve: (value: unknown) => void) => Promise.resolve(rows[table]).then(resolve),
      };
      return query;
    },
};

import { FloorAlertHandReview } from "./FloorAlertHandReview";

afterEach(cleanup);

describe("FloorAlertHandReview", () => {
  it("shows server actions without exposing cards or edit controls", async () => {
    render(<FloorAlertHandReview tournamentId="tour-1" handId="hand-12" physicalTableId="physical-5" tournamentTableId="tt-5" />);
    expect(await screen.findByText(/Ghế 4 · call 200.000/)).toBeVisible();
    expect(screen.getByText(/Hand #12/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Sửa|Lưu/i })).toBeNull();
  });

  it("fails closed when the hand belongs to another table", async () => {
    render(<FloorAlertHandReview tournamentId="tour-1" handId="hand-12" physicalTableId="physical-6" tournamentTableId="tt-6" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("bàn/giải không khớp");
  });
});
