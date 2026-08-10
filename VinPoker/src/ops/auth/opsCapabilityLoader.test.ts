import { describe, expect, it, vi } from "vitest";
import {
  loadOpsCapabilities,
  loadSuperAdminClubPage,
  verifySuperAdminClub,
  type OpsRpcClient,
} from "@/ops/auth/opsCapabilityLoader";

const clubId = "10000000-0000-4000-8000-000000000001";
const unifiedRow = {
  club_id: clubId,
  can_owner: false,
  can_floor: true,
  can_cashier: false,
  can_tracker: true,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
};

function clientWith(results: Array<{ data: unknown; error: { code?: string; message?: string } | null }>) {
  const rpc = vi.fn();
  for (const result of results) rpc.mockResolvedValueOnce(result);
  return { client: { rpc } as OpsRpcClient, rpc };
}

describe("Ops V3 capability loader", () => {
  it("uses unified caller-bound scope and global capability", async () => {
    const { client, rpc } = clientWith([
      { data: [unifiedRow], error: null },
      { data: [{ is_super_admin: false }], error: null },
    ]);
    await expect(loadOpsCapabilities(client)).resolves.toEqual({
      scope: [unifiedRow],
      global: { is_super_admin: false },
      source: "unified",
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_my_ops_capability_scope",
      "get_my_ops_global_capability",
    ]);
  });

  it("falls back only when the unified scope RPC is missing", async () => {
    const { client, rpc } = clientWith([
      { data: null, error: { code: "42883" } },
      { data: [{ club_id: clubId, can_owner: false, can_cashier: true, can_floor: false }], error: null },
    ]);
    const loaded = await loadOpsCapabilities(client);
    expect(loaded.source).toBe("legacy");
    expect(loaded.scope[0]).toMatchObject({
      club_id: clubId,
      can_cashier: true,
      can_tracker: false,
      can_fnb_kitchen: false,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("retries one fresh-token clock-skew response without falling back", async () => {
    vi.useFakeTimers();
    try {
      const { client, rpc } = clientWith([
        { data: null, error: { code: "PGRST303", message: "JWT issued at future" } },
        { data: [unifiedRow], error: null },
        { data: [{ is_super_admin: false }], error: null },
      ]);
      const loaded = loadOpsCapabilities(client);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(loaded).resolves.toMatchObject({ source: "unified", scope: [unifiedRow] });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "get_my_ops_capability_scope",
        "get_my_ops_capability_scope",
        "get_my_ops_global_capability",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["42501", "500", "PGRST301"])("fails closed for %s without legacy fallback", async (code) => {
    const { client, rpc } = clientWith([{ data: null, error: { code } }]);
    await expect(loadOpsCapabilities(client)).rejects.toThrow(`unified capability: ${code}`);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the unified response is malformed", async () => {
    const { client, rpc } = clientWith([{ data: [{ club_id: clubId }], error: null }]);
    await expect(loadOpsCapabilities(client)).rejects.toThrow("unexpected or missing fields");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not hide a partially deployed global RPC behind the legacy fallback", async () => {
    const { client, rpc } = clientWith([
      { data: [unifiedRow], error: null },
      { data: null, error: { code: "42883" } },
    ]);
    await expect(loadOpsCapabilities(client)).rejects.toThrow("global capability: 42883");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("keeps super-admin discovery bounded and verifies a refreshed club id", async () => {
    const { client, rpc } = clientWith([
      { data: [{ club_id: clubId, club_name: "HSOP" }], error: null },
      { data: [{ club_id: clubId, club_name: "HSOP" }], error: null },
    ]);
    await expect(loadSuperAdminClubPage(client, { search: "HS", limit: 500 })).resolves.toHaveLength(1);
    await expect(verifySuperAdminClub(client, clubId)).resolves.toEqual({ club_id: clubId, club_name: "HSOP" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_search: "HS", p_limit: 100 });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_search: clubId, p_limit: 1 });
  });
});
