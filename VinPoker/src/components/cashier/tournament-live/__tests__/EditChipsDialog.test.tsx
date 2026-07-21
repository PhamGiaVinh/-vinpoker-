import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true }, error: null })));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EditChipsDialog } from "../EditChipsDialog";

afterEach(() => {
  cleanup();
  invoke.mockClear();
});

describe("EditChipsDialog chip CAS", () => {
  it("sends the rendered server snapshot as expected_chip_count", async () => {
    render(
      <EditChipsDialog
        open
        onOpenChange={vi.fn()}
        tournamentId="tournament-1"
        seat={{
          seat_id: "seat-1",
          player_id: "player-1",
          player_name: "TEST Player",
          entry_number: 1,
          table_id: "table-1",
          table_name: "Bàn 1",
          seat_number: 2,
          chip_count: 10_000,
        }}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chip" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("tournament-live-draw", {
      body: {
        tournament_id: "tournament-1",
        action: "update_seats",
        seats: [{
          seat_id: "seat-1",
          player_id: "player-1",
          entry_number: 1,
          table_id: "table-1",
          seat_number: 2,
          expected_chip_count: 10_000,
          chip_count: 12_000,
          is_active: true,
          player_name: "TEST Player",
        }],
      },
    });
  });
});
