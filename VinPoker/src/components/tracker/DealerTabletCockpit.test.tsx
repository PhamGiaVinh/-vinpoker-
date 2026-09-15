import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { DealerTabletLayout } from "./DealerTabletCockpit";

afterEach(cleanup);
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
