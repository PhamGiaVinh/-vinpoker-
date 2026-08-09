import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FloorTableControlModeControl } from "./FloorTableControlMode";

afterEach(cleanup);

describe("FloorTableControlModeControl", () => {
  it("uses the visual Manual Floor and Live Tracker chooser in an existing table", () => {
    const client = { rpc: vi.fn() } as never;
    render(
      <SupabaseClientProvider client={client}>
        <FloorTableControlModeControl
          tournamentId="tournament-1"
          table={{
            tt_id: "table-1",
            table_name: "Bàn 2",
            floor_control_mode: "manual",
            floor_control_revision: 3,
          }}
          onChanged={vi.fn()}
        />
      </SupabaseClientProvider>,
    );

    expect(screen.getByTestId("floor-table-control-mode-manual")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("floor-table-control-mode-tracker")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Lưu chế độ bàn" })).toBeDisabled();

    fireEvent.click(screen.getByTestId("floor-table-control-mode-tracker"));

    expect(screen.getByTestId("floor-table-control-mode-tracker")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Lưu chế độ bàn" })).toBeEnabled();
  });
});
