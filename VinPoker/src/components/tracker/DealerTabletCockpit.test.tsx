import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: true } }));
vi.mock("@/ops/chip-ops/MultiDayBaggingPanel", () => ({
  MultiDayBaggingPanel: ({ tournamentId }: { tournamentId: string }) => <p>Dealer bagging for {tournamentId}</p>,
}));
import { supabase } from "@/integrations/supabase/client";
import { DealerTabletCockpit, DealerTabletLayout } from "./DealerTabletCockpit";

afterEach(cleanup);
beforeEach(() => { vi.mocked(supabase.rpc).mockReset(); vi.mocked(supabase.from).mockReset(); });
const hook = { actions: [], syncPhase: "idle", tableId: "table" } as unknown as StandaloneHandInput;
const props = { hook, header: null, orphan: null, progress: null, felt: <p>Bàn</p>, board: null, voice: <p>Voice mounted</p>, guided: <p>Manual writer</p>, log: null };
describe("Dealer tablet modes", () => {
  it("does not mount any writer when Floor permission is absent", () => {
    render(<DealerTabletLayout {...props} trackerAllowed={false} />);
    expect(screen.getByRole("button", { name: "Tracker", exact: true }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Manual writer")).toBeNull();
    expect(screen.queryByText("Voice mounted")).toBeNull();
  });
  it("unmounts Voice when switching to normal or when authority is lost", () => {
    const { rerender } = render(<DealerTabletLayout {...props} trackerAllowed />);
    fireEvent.click(screen.getByRole("button", { name: "Voice Assist", exact: true }));
    expect(screen.getByText("Voice mounted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thường", exact: true }));
    expect(screen.queryByText("Voice mounted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tracker", exact: true }));
    expect(screen.getByText("Voice mounted")).toBeTruthy();
    rerender(<DealerTabletLayout {...props} trackerAllowed={false} />);
    expect(screen.queryByText("Voice mounted")).toBeNull();
  });
});

describe("Dealer tablet server context", () => {
  const row = { tournament_id: "tournament", tournament_table_id: "table", table_session_id: "session", control_epoch: 1, control_mode: "tracker", tournament_table_status: "active", session_closed_at: null, table_number: null };
  const boundProps = { ...props, hook: { ...hook, tournamentId: "tournament", tournamentTableId: "table" } as StandaloneHandInput };
  function respond(rows: unknown[], allowed = true) {
    vi.mocked(supabase.rpc).mockImplementation((async (name: string) => ({ data: name === "get_floor_tournament_table_roster_v3" ? rows : { ok: allowed, error: allowed ? undefined : "STALE_TRACKER_CONTEXT" }, error: null })) as never);
  }
  it("places server-scoped bag entry on the dealer tablet only for flights", async () => {
    respond([row]);
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { phase: "flight" }, error: null }) }) }),
    } as never);
    render(<DealerTabletCockpit {...boundProps} />);
    expect(await screen.findByText("Dealer bagging for tournament")).toBeTruthy();
  });
  it("accepts server-validated session authority even with a null display table number", async () => {
    respond([row]);
    render(<DealerTabletCockpit {...boundProps} />);
    await screen.findByText("Manual writer");
    expect(supabase.rpc).toHaveBeenCalledWith("validate_tracker_table_writer_context_v3", { p_tournament_id: "tournament", p_tournament_table_id: "table", p_table_session_id: "session", p_control_epoch: 1 });
  });
  it.each([
    [{ ...row, control_mode: "manual" }], [{ ...row, session_closed_at: "2026-09-16" }],
    [{ ...row, tournament_id: "other" }], [row, row],
  ])("denies invalid or ambiguous session context before writer validation", async (...rows) => {
    respond(rows);
    render(<DealerTabletCockpit {...boundProps} />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Manual writer")).toBeNull();
  });
  it("keeps Tracker locked when the server rejects the current epoch", async () => {
    respond([row], false);
    render(<DealerTabletCockpit {...boundProps} />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Manual writer")).toBeNull();
  });
});
