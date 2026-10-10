import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState } from "react";

const state = vi.hoisted(() => ({ reads: vi.fn(), channels: vi.fn(), removed: vi.fn(), pick: "new-tour" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ is: () => ({ in: () => ({ order: () => ({ in: state.reads }) }) }) }) }),
  channel: (name: string) => { state.channels(name); const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: state.removed,
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/floor/FloorTournamentsLanding", () => ({
  FloorTournamentsLanding: ({ onSelect }: { onSelect: (id: string) => void }) =>
    <button onClick={() => onSelect(state.pick)}>Vào tour TEST vừa tạo</button>,
}));
vi.mock("@/components/cashier/tournament-live/FloorTableMapPanel", () => ({
  FloorTableMapPanel: ({ tournament }: { tournament: { id: string } }) => <div>Bàn của {tournament.id}</div>,
}));
vi.mock("@/components/cashier/tournament-live/TrackerFloorAlertLane", () => ({ TrackerFloorAlertLane: () => null }));
vi.mock("@/components/cashier/tournament-live/CloseReportDialog", () => ({ default: () => null }));
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";

const scope = ["club"];
const clubs = [{ id: "club", name: "TEST" }];
const oldTour = { id: "old-tour", club_id: "club", name: "Old TEST", status: "live" };
const newTour = { id: "new-tour", club_id: "club", name: "New TEST", status: "active" };
beforeEach(() => { state.reads.mockReset(); state.channels.mockReset(); state.removed.mockReset(); state.pick = "new-tour"; });
afterEach(cleanup);

describe("Floor resolves a newly created tournament against the canonical server list", () => {
  it("keeps the real panel's list read and subscription stable during parent selection updates", async () => {
    state.pick = "old-tour";
    state.reads.mockResolvedValue({ data: [oldTour], error: null });
    function Parent() {
      const [selected, setSelected] = useState<string | null>(null);
      const stableScope = useMemo(() => clubs.map((club) => club.id), []);
      const onSelection = useCallback((id: string | null) => setSelected(id), []);
      return <><span data-testid="parent-selection">{selected}</span><TournamentLivePanel clubIds={stableScope} clubs={clubs} mode="floor" onSelectedTournamentChange={onSelection} /></>;
    }
    render(<Parent />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByText("Bàn của old-tour")).toBeVisible();
    expect(screen.getByTestId("parent-selection")).toHaveTextContent("old-tour");
    expect(state.reads).toHaveBeenCalledTimes(1);
    expect(state.channels).toHaveBeenCalledTimes(1);
    expect(state.channels).toHaveBeenCalledWith("tournament-live:old-tour");
    expect(state.removed).not.toHaveBeenCalled();
  });

  it("refreshes a missing selection and opens its operational tabs without reloading the page", async () => {
    state.reads.mockResolvedValueOnce({ data: [oldTour], error: null });
    let finish!: (value: unknown) => void;
    state.reads.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải giải đã chọn");
    await act(async () => { finish({ data: [newTour, oldTour], error: null }); });
    expect(await screen.findByText("Bàn của new-tour")).toBeVisible();
    expect(state.reads).toHaveBeenCalledTimes(2);
  });

  it("does not add a duplicate read for an already loaded tournament", async () => {
    state.pick = "old-tour";
    state.reads.mockResolvedValue({ data: [oldTour], error: null });
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByText("Bàn của old-tour")).toBeVisible();
    expect(state.reads).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit read failure and retries the same selection", async () => {
    state.reads.mockResolvedValueOnce({ data: [oldTour], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "503 TEST" } })
      .mockResolvedValueOnce({ data: [newTour, oldTour], error: null });
    render(<TournamentLivePanel clubIds={scope} clubs={clubs} mode="floor" />);
    await waitFor(() => expect(state.reads).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vào tour TEST vừa tạo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được giải đã chọn");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Bàn của new-tour")).toBeVisible();
  });
});
