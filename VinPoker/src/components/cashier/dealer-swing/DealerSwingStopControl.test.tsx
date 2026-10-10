import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ actorId: "actor-a", upsert: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ upsert: state.upsert }) } }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
import { DealerSwingStopControl } from "./DealerSwingStopControl";

describe("shared emergency Swing OFF", () => {
  beforeEach(() => { state.actorId = "actor-a"; state.upsert.mockReset(); state.success.mockReset(); state.error.mockReset(); });
  it("submits explicit OFF and never toggles on, even after repeated clicks", async () => {
    let finish!: (result: { error: null }) => void;
    state.upsert.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    const confirm = screen.getByRole("button", { name: /^Dừng$/ });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.upsert).toHaveBeenCalledOnce();
    expect(state.upsert).toHaveBeenCalledWith({ club_id: "club-a", auto_swing_enabled: false }, { onConflict: "club_id" });
    finish({ error: null });
    await waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
  });
  it("does not acknowledge a denied write", async () => {
    state.upsert.mockResolvedValue({ error: { message: "DENIED TEST" } });
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith("DENIED TEST"));
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Dừng$/ })).toBeInTheDocument();
  });

  it("does not acknowledge a late club A response after A to B to A", async () => {
    let finish!: (result: { error: null }) => void;
    state.upsert.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    view.rerender(<DealerSwingStopControl clubId="club-b" onStopped={onStopped} />);
    view.rerender(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    await act(async () => { finish({ error: null }); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("does not acknowledge a response after unmount", async () => {
    let finish!: (result: { error: null }) => void;
    state.upsert.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    view.unmount();
    await act(async () => { finish({ error: null }); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("closes old confirmation and ignores the old response after actor changes in the same club", async () => {
    let finish!: (result: { error: null }) => void;
    state.upsert.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    state.actorId = "actor-b";
    view.rerender(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await act(async () => { finish({ error: null }); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });
});
