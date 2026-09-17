import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);
const mock = vi.hoisted(() => ({ rpc: vi.fn(), rotated: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
import { SatelliteTicketCodeRotation } from "../SatelliteTicketCodeRotation";

const oldCode = "a1111111-1111-4111-8111-111111111111";
const newCode = "b2222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mock.rpc.mockReset(); mock.rotated.mockReset();
  mock.rpc.mockResolvedValue({ data: { ok: true, serial: 7, code: newCode }, error: null });
});

describe("Satellite code replacement", () => {
  it("requires a reason and confirmation, then keeps the same serial", async () => {
    render(<SatelliteTicketCodeRotation sourceTournamentId="source" serial={7}
      code={oldCode} onRotated={mock.rotated} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace private code" }));
    const action = screen.getByRole("button", { name: "Invalidate old code + issue replacement" });
    expect(action).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement reason for ticket 7" }),
      { target: { value: "Original paper ticket lost" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("satellite_rotate_ticket_code_v1", {
      p_source_tournament_id: "source", p_serial: 7, p_expected_code: oldCode,
      p_reason: "Original paper ticket lost", p_request_id: expect.any(String),
    }));
    expect(mock.rotated).toHaveBeenCalledTimes(1);
  });

  it("does not claim success if the server repeats the old code", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, serial: 7, code: oldCode }, error: null });
    render(<SatelliteTicketCodeRotation sourceTournamentId="source" serial={7}
      code={oldCode} onRotated={mock.rotated} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace private code" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement reason for ticket 7" }),
      { target: { value: "Original paper ticket lost" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Invalidate old code + issue replacement" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent",
      "Server did not confirm a new code. Refresh the ticket ledger before retrying.");
    expect(mock.rotated).not.toHaveBeenCalled();
  });
});
