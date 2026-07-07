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

// B1 — mid-hand DISPLAY-ONLY mode (handInProgress): name/avatar route to the
// display-only RPC (never onSetSeat), chips are locked, and no walk-ins can be added.
describe("SeatSetupPanel — mid-hand (handInProgress)", () => {
  function setupMid() {
    const onSetSeat = vi.fn(() => Promise.resolve({ ok: true }));
    const onSetSeatDisplay = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <SeatSetupPanel
        tournamentId="T1"
        tableId="TB1"
        players={PLAYERS}
        maxSeats={4}
        avatarSupported={true}
        onSetSeat={onSetSeat}
        handInProgress
        onSetSeatDisplay={onSetSeatDisplay}
      />
    );
    return { onSetSeat, onSetSeatDisplay };
  }

  it("shows the mid-hand header + hint and hides 'Thêm người' (no walk-ins mid-hand)", () => {
    setupMid();
    expect(screen.getByText(/Sửa tên · ảnh/)).toBeTruthy(); // mid-hand header
    expect(screen.getByText(/chỉ sửa được tên\/ảnh/i)).toBeTruthy(); // amber hint
    expect(screen.queryByText("Thêm người")).toBeNull();
  });

  it("the chip input is disabled while a hand is in progress", () => {
    setupMid();
    fireEvent.click(screen.getAllByText("Sửa")[0]); // seat 1
    expect(screen.getByLabelText("Số chip")).toBeDisabled();
  });

  it("saving a name routes to onSetSeatDisplay (name only), NOT the chip-writing onSetSeat", async () => {
    const { onSetSeat, onSetSeatDisplay } = setupMid();
    fireEvent.click(screen.getAllByText("Sửa")[0]); // seat 1
    fireEvent.change(screen.getByLabelText("Tên người chơi"), { target: { value: "N. HOÀNG SỬA" } });
    // the save button sits next to the chip input in the edit form
    fireEvent.click(screen.getByLabelText("Số chip").parentElement!.querySelector("button")!);
    await waitFor(() =>
      expect(onSetSeatDisplay).toHaveBeenCalledWith(
        expect.objectContaining({ seatNumber: 1, playerName: "N. HOÀNG SỬA" })
      )
    );
    expect(onSetSeat).not.toHaveBeenCalled();
    // display path carries NO chip field
    expect(onSetSeatDisplay.mock.calls[0][0]).not.toHaveProperty("chipCount");
  });

  it("uploading an avatar mid-hand routes to onSetSeatDisplay with touchAvatar (never onSetSeat)", async () => {
    const { onSetSeat, onSetSeatDisplay } = setupMid();
    fireEvent.click(screen.getByLabelText("Ảnh ghế 1"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "pic.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onSetSeatDisplay).toHaveBeenCalled());
    expect(onSetSeatDisplay).toHaveBeenCalledWith(
      expect.objectContaining({ seatNumber: 1, touchAvatar: true, avatarUrl: expect.stringContaining("seat-avatars") })
    );
    expect(onSetSeat).not.toHaveBeenCalled();
  });

  // A0 review fix: CLEARING an avatar mid-hand must route to the display RPC with an
  // explicit null (the hook merge then trusts the echo — `seat.avatar_url ?? null` —
  // so the felt actually drops the avatar instead of keeping the stale url).
  it("clearing an avatar mid-hand routes to onSetSeatDisplay with avatarUrl null (never onSetSeat)", async () => {
    const { onSetSeat, onSetSeatDisplay } = setupMid();
    // seat 3 has an avatar → its clear (X) button renders
    fireEvent.click(screen.getByLabelText("Xoá ảnh ghế 3"));
    await waitFor(() =>
      expect(onSetSeatDisplay).toHaveBeenCalledWith(
        expect.objectContaining({ seatNumber: 3, touchAvatar: true, avatarUrl: null })
      )
    );
    expect(onSetSeat).not.toHaveBeenCalled();
  });
});
