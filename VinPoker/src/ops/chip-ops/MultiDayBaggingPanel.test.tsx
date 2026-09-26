import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc: h.rpc };
  return { useSupabaseClient: () => client };
});
import { MultiDayBaggingPanel } from "./MultiDayBaggingPanel";
import { parseMultiDayBaggingState } from "./multiDayBaggingState";

const playerId = "60000000-0000-0000-0000-000000000001";
const state = {
  status: "bagging", dayNumber: 1, dayVersion: 0, rosterHash: "abc", manager: true,
  rows: [{ playerId, seatNumber: 3, trackedStack: 100000,
    bagCode: null, bagTotal: null, bagRevision: 0, sealed: false, sealedVersion: null }],
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => name === "multi_day_bagging_state_v1"
    ? { data: state, error: null } : { data: { ok: true }, error: null });
  vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
});

describe("flight bagging UI", () => {
  it("rejects a malformed server roster rather than treating it as empty", () => {
    expect(() => parseMultiDayBaggingState({ ...state, rows: [{ ...state.rows[0], trackedStack: "100000" }] }))
      .toThrow("Bagging roster is invalid.");
  });

  it("shows a loading state, then submits explicit total and expected revision", async () => {
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    expect(screen.getByText("Loading frozen flight roster…")).toBeTruthy();
    await screen.findByText(/Tracker stack: 100,000/);
    expect(screen.getByRole("button", { name: "Seal" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: `Bag code for ${playerId}` }),
      { target: { value: "BAG-01" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: `Bag total for ${playerId}` }),
      { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("multi_day_record_bag_v1", {
      p_flight_tournament_id: "flight-id",p_player_id: playerId,p_bag_code: "BAG-01",
      p_total_value: 100000,p_expected_revision: 0,p_request_id: "request-id",
    }));
  });

  it("holds actions when the server read fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "multi_day_bagging_not_open" } });
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByRole("alert");
    expect(screen.getByText("End Flight has not opened bagging for this flight.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("reuses the same request id when retrying an uncertain save", async () => {
    let saves = 0;
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "multi_day_bagging_state_v1") return { data: state, error: null };
      saves += 1;
      return saves === 1
        ? { data: null, error: { message: "network unavailable" } }
        : { data: { ok: true }, error: null };
    });
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByText(/Tracker stack: 100,000/);
    fireEvent.change(screen.getByRole("textbox", { name: `Bag code for ${playerId}` }),
      { target: { value: "BAG-01" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: `Bag total for ${playerId}` }),
      { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.rpc.mock.calls.filter(([name]) => name === "multi_day_record_bag_v1")).toHaveLength(2));
    const calls = h.rpc.mock.calls.filter(([name]) => name === "multi_day_record_bag_v1");
    expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
  });

  it("keeps seal and close unavailable for dealer-only read scope", async () => {
    h.rpc.mockResolvedValue({ data: { ...state, manager: false }, error: null });
    render(<MultiDayBaggingPanel tournamentId="flight-id" />);
    await screen.findByText(/Tracker stack: 100,000/);
    expect(screen.queryByRole("button", { name: "Seal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock flight bagging" })).toBeNull();
  });
});
