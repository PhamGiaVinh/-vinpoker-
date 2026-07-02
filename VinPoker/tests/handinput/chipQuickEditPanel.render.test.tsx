// A3 (trackerChipQuickEdit) — chip-integrity guards pinned here: Save stays disabled
// until a reason is picked; on save, the seat_id/entry_number/seat_number sent to
// update_seats come from a FRESH `tournament_seats` re-fetch (never the client's
// cached values — that's the update_seats insert-footgun guard), and the caller is
// handed back the server-CONFIRMED chip_count (a second re-fetch), not the raw input.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { invokeSpy, fromSpy, FRESH_SEAT, CONFIRMED_CHIP } = vi.hoisted(() => {
  const FRESH_SEAT = { id: "seat-server-id", entry_number: 1, seat_number: 3, player_name: "An" };
  const CONFIRMED_CHIP = 7100000; // deliberately different from the typed input, to prove re-fetch wins
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: FRESH_SEAT, error: null }),
  };
  const confirmChain: any = {
    select: () => confirmChain,
    eq: () => confirmChain,
    maybeSingle: () => Promise.resolve({ data: { chip_count: CONFIRMED_CHIP }, error: null }),
  };
  let call = 0;
  return {
    FRESH_SEAT,
    CONFIRMED_CHIP,
    invokeSpy: vi.fn(() => Promise.resolve({ data: { data: { updated: 1 } }, error: null })),
    fromSpy: vi.fn(() => (call++ === 0 ? chain : confirmChain)),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromSpy, functions: { invoke: invokeSpy } },
}));

// eslint-disable-next-line import/first
import { ChipQuickEditPanel } from "@/components/cashier/tournament-live/handinput/ChipQuickEditPanel";

afterEach(() => {
  cleanup();
  invokeSpy.mockClear();
  fromSpy.mockClear();
});

const PLAYERS = [
  { player_id: "p1", seat_number: 3, display_name: "An", current_stack: 5000000 },
  { player_id: "p2", seat_number: 5, display_name: "Bình", current_stack: 3000000 },
];

describe("ChipQuickEditPanel", () => {
  it("renders every seated player with their current stack, nothing else", () => {
    render(<ChipQuickEditPanel tournamentId="t1" tableId="tb1" players={PLAYERS} onUpdated={() => {}} />);
    expect(screen.getByText(/Ghế 3 · An/)).toBeTruthy();
    expect(screen.getByText(/Ghế 5 · Bình/)).toBeTruthy();
  });

  it("no players → renders nothing", () => {
    const { container } = render(
      <ChipQuickEditPanel tournamentId="t1" tableId="tb1" players={[]} onUpdated={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("opening a row's edit form disables Save until a reason is picked", () => {
    render(<ChipQuickEditPanel tournamentId="t1" tableId="tb1" players={PLAYERS} onUpdated={() => {}} />);
    fireEvent.click(screen.getByLabelText("Sửa chip An"));
    const saveBtn = screen.getByText("Lưu").closest("button")!;
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Lý do sửa chip"), { target: { value: "buyback" } });
    expect(saveBtn).not.toBeDisabled();
  });

  it("Save re-fetches the seat server-side (never trusts a cached seat_id) and hands the caller the CONFIRMED post-write chip_count", async () => {
    const onUpdated = vi.fn();
    render(<ChipQuickEditPanel tournamentId="t1" tableId="tb1" players={PLAYERS} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByLabelText("Sửa chip An"));
    fireEvent.change(screen.getByLabelText("Số chip mới"), { target: { value: "6500000" } });
    fireEvent.change(screen.getByLabelText("Lý do sửa chip"), { target: { value: "correction" } });
    fireEvent.click(screen.getByText("Lưu"));

    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    const body = invokeSpy.mock.calls[0][1].body;
    expect(body.action).toBe("update_seats");
    expect(body.seats[0].seat_id).toBe(FRESH_SEAT.id); // fresh, not a caller-supplied value
    expect(body.seats[0].chip_count).toBe(6500000);

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith("p1", CONFIRMED_CHIP));
  });
});
