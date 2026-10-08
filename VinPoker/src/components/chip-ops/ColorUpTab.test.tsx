import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), actor: "owner-a" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: h.actor } }) }));
import { ColorUpTab } from "./ColorUpTab";
const key = "vinpoker:color-up-pending:owner-a:club-a:tour-a";
const intent = { fn: "chip_ops_color_up", args: { p_tournament_id: "tour-a", p_denom_removed: "low", p_denom_target: "high", p_target_added: 1, p_level_number: 2, p_idempotency_key: "original-request" } };
beforeEach(() => {
  sessionStorage.clear(); h.actor = "owner-a"; h.rpc.mockReset(); h.from.mockReset();
  h.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_level: null }, error: null }) }) }) }));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_color_up_history" ? { operations: [] } : { status: "ok" }, error: null }));
});
it("reconciles a persisted unknown mutation with the identical key and payload", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Kiểm tra lại cùng thao tác" }));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(intent.fn, intent.args));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
});
it("retains the original receipt on response loss and blocks rapid duplicate dispatch", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  let reject!: (error: Error) => void;
  h.rpc.mockImplementation((name: string) => name === intent.fn ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Kiểm tra lại cùng thao tác" });
  fireEvent.click(retry); fireEvent.click(retry);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(1);
  await act(async () => reject(new TypeError("Failed to fetch")));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(screen.getByRole("button", { name: "Kiểm tra lại cùng thao tác" }).hasAttribute("disabled")).toBe(false);
});
it("does not show a failed inventory read as an empty successful history", async () => {
  h.rpc.mockResolvedValue({ data: null, error: { status: 503 } });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText(/Không xác minh được tồn chip hoặc lịch sử/);
  expect(screen.queryByText("Chưa có color-up nào.")).toBeNull();
});
it("does not reuse another account's pending mutation", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.actor = "owner-b";
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText("Chưa có color-up nào.");
  expect(screen.queryByRole("button", { name: "Kiểm tra lại cùng thao tác" })).toBeNull();
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
