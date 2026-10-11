import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: h }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isClubOwner: true, isChipMaster: false, user: { id: "owner-a" } }) }));
vi.mock("./DashboardTab", () => ({ DashboardTab: () => null }));
vi.mock("./BankAuditTab", () => ({ BankAuditTab: () => null }));
vi.mock("./BagTagTab", () => ({ BagTagTab: () => null }));
import { ChipOpsManager } from "./ChipOpsManager";

it("opens the existing setup tab from the real empty Color-Up view without mutating chips", async () => {
  h.from.mockImplementation((table: string) => {
    const result = { data: table === "tournaments" ? [{ id: "tour-a", name: "TEST", club_id: "club-a" }] : [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "eq", "in", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_color_up_history" ? { operations: [] } : {}, error: null }));
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Color-Up" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("button", { name: "Mở Setup stack" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Setup stack" })).toHaveAttribute("aria-selected", "true"));
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});
