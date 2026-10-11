import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: {
  isClubOwner: true, isChipMaster: false, user: { id: "owner-a" },
  loading: false, rolesLoading: false, authError: null as string | null, rolesError: null as string | null,
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: h }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("./DashboardTab", () => ({ DashboardTab: () => null }));
vi.mock("./BankAuditTab", () => ({ BankAuditTab: () => null }));
vi.mock("./BagTagTab", () => ({ BagTagTab: () => null }));
import { ChipOpsManager } from "./ChipOpsManager";

beforeEach(() => {
  h.auth = { isClubOwner: true, isChipMaster: false, user: { id: "owner-a" }, loading: false, rolesLoading: false, authError: null, rolesError: null };
  h.rpc.mockClear();
  h.from.mockClear();
  h.from.mockImplementation((table: string) => {
    const result = { data: table === "tournaments" ? [{ id: "tour-a", name: "TEST", club_id: "club-a" }] : [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "eq", "in", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_color_up_history" ? { operations: [] } : {}, error: null }));
});

it("does not report missing permission while roles are loading", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesLoading = true;
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh quyền Chip Ops");
  await act(async () => {});
});

it("shows an authority read error rather than denied permission", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesError = "Không tải được quyền";
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh được quyền Chip Ops");
  await act(async () => {});
});

it("still denies verified users without Chip Ops permission", async () => {
  h.auth.isClubOwner = false;
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByText("Bạn không có quyền truy cập Chip Ops.")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("opens the workspace only after pending roles resolve to an authorized owner", async () => {
  h.auth.isClubOwner = false;
  h.auth.rolesLoading = true;
  const view = render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  h.auth = { ...h.auth, rolesLoading: false, isClubOwner: true };
  view.rerender(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  await screen.findByRole("tab", { name: "Setup stack" });
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  await act(async () => {});
});

it("does not expose actions on authority failure even if a previous owner flag remains", async () => {
  h.auth.rolesError = "temporary backend error";
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("waits for authentication before showing a previous owner workspace", async () => {
  h.auth.loading = true;
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác minh quyền Chip Ops");
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  await act(async () => {});
});

it("shows authentication failure as unverified rather than denied", async () => {
  h.auth.isClubOwner = false;
  h.auth.authError = "temporary authentication failure";
  render(<MemoryRouter><ChipOpsManager /></MemoryRouter>);
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh được quyền Chip Ops");
  expect(screen.queryByText("Bạn không có quyền truy cập Chip Ops.")).not.toBeInTheDocument();
  await act(async () => {});
});

it("opens the existing setup tab from the real empty Color-Up view without mutating chips", async () => {
  render(<MemoryRouter initialEntries={["/chip-ops?t=tour-a"]}><ChipOpsManager /></MemoryRouter>);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Color-Up" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("button", { name: "Mở Setup stack" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Setup stack" })).toHaveAttribute("aria-selected", "true"));
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});
