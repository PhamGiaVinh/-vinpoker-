// trackerSeatSetup — SeatSetupPanel: pre-hand roster editor. Pins: occupied seats show
// name+chip+avatar controls; empty seats offer "Thêm người"; avatarSupported=false →
// avatar disabled + "chưa áp dụng" banner; edit/add call the single onSetSeat (atomic
// RPC) with the right args; avatar upload → storage → onSetSeat with touchAvatar+url.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { uploadSpy, getPublicUrlSpy } = vi.hoisted(() => ({
  uploadSpy: vi.fn(() => Promise.resolve({ error: null })),
  getPublicUrlSpy: vi.fn(() => ({ data: { publicUrl: "https://x/storage/v1/object/public/tournament-photos/T1/seat-avatars/abc.jpg" } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ upload: uploadSpy, getPublicUrl: getPublicUrlSpy }) } },
}));
vi.mock("@/lib/compressImage", () => ({ compressImage: (f: File) => Promise.resolve(f) }));

// eslint-disable-next-line import/first
import { SeatSetupPanel, type RosterSeat } from "@/components/cashier/tournament-live/handinput/SeatSetupPanel";

afterEach(() => cleanup());
beforeEach(() => {
  uploadSpy.mockClear();
  getPublicUrlSpy.mockClear();
});

const PLAYERS: RosterSeat[] = [
  { player_id: "p1", seat_number: 1, display_name: "N. HOÀNG", current_stack: 5000000, avatar_url: null },
  { player_id: "p2", seat_number: 3, display_name: "T. ANH", current_stack: 2400000, avatar_url: "https://x/a.jpg" },
];

function setup(over: Partial<React.ComponentProps<typeof SeatSetupPanel>> = {}) {
  const onSetSeat = vi.fn(() => Promise.resolve({ ok: true }));
  render(
    <SeatSetupPanel
      tournamentId="T1"
      tableId="TB1"
      players={PLAYERS}
      maxSeats={4}
      avatarSupported={true}
      onSetSeat={onSetSeat}
      {...over}
    />
  );
  return { onSetSeat };
}

describe("SeatSetupPanel", () => {
  it("renders occupied seats + a 'Thêm người' for each empty seat (up to maxSeats)", () => {
    setup();
    expect(screen.getByText(/Ghế 1 · N\. HOÀNG/)).toBeTruthy();
    expect(screen.getByText(/Ghế 3 · T\. ANH/)).toBeTruthy();
    // maxSeats=4, occupied {1,3} → empties {2,4}
    expect(screen.getByText(/Ghế 2 · trống/)).toBeTruthy();
    expect(screen.getByText(/Ghế 4 · trống/)).toBeTruthy();
    expect(screen.getAllByText("Thêm người").length).toBe(2);
  });

  it("avatarSupported=false → avatar buttons disabled + a 'chưa áp dụng' banner", () => {
    setup({ avatarSupported: false });
    expect(screen.getByText(/chưa được áp dụng/)).toBeTruthy();
    expect(screen.getByLabelText("Ảnh ghế 1").closest("button")).toBeDisabled();
  });

  it("editing a seat calls onSetSeat with name+chip and the existing player_id", async () => {
    const { onSetSeat } = setup();
    fireEvent.click(screen.getAllByText("Sửa")[0]); // seat 1
    fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "N. HOÀNG 2" } });
    fireEvent.change(screen.getByLabelText("Số chip"), { target: { value: "9000000" } });
    fireEvent.click(screen.getByLabelText("Số chip").parentElement!.querySelector("button")!);
    await waitFor(() =>
      expect(onSetSeat).toHaveBeenCalledWith(
        expect.objectContaining({ seatNumber: 1, playerName: "N. HOÀNG 2", chipCount: 9000000, existingPlayerId: "p1" })
      )
    );
  });

  it("adding a walk-in calls onSetSeat with the empty seat number and NO existing player_id", async () => {
    const { onSetSeat } = setup();
    // open the "Thêm người" for seat 2
    const addBtns = screen.getAllByText("Thêm người");
    fireEvent.click(addBtns[0]); // seat 2 (first empty)
    fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "Khách lạ" } });
    fireEvent.change(screen.getByLabelText("Số chip"), { target: { value: "3000000" } });
    fireEvent.click(screen.getByLabelText("Số chip").parentElement!.querySelector("button")!);
    await waitFor(() =>
      expect(onSetSeat).toHaveBeenCalledWith(
        expect.objectContaining({ seatNumber: 2, playerName: "Khách lạ", chipCount: 3000000, existingPlayerId: null })
      )
    );
  });

  it("uploading an avatar goes to storage then onSetSeat with touchAvatar + the public URL", async () => {
    const { onSetSeat } = setup();
    // trigger the hidden file input for seat 1
    fireEvent.click(screen.getByLabelText("Ảnh ghế 1"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "pic.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadSpy).toHaveBeenCalled());
    // path is tournament-scoped seat-avatars
    expect(uploadSpy.mock.calls[0][0]).toMatch(/^T1\/seat-avatars\//);
    await waitFor(() =>
      expect(onSetSeat).toHaveBeenCalledWith(
        expect.objectContaining({ seatNumber: 1, touchAvatar: true, avatarUrl: expect.stringContaining("seat-avatars") })
      )
    );
  });
});
