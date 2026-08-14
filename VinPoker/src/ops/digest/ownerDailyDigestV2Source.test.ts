import { describe, expect, it } from "vitest";
import {
  createOwnerDailyDigestV2Source,
  type OwnerDailyDigestV2RpcClient,
} from "@/ops/digest/ownerDailyDigestV2Source";
import { OWNER_DIGEST_TEST_CLUB_A } from "@/ops/digest/ownerDailyDigestFixtures";

describe("Owner Daily Digest V2 server boundary", () => {
  it("parses scoped clubs without exposing contact fields", async () => {
    const source = createOwnerDailyDigestV2Source(clientWith({
      list_owner_daily_digest_clubs_v2: [{
        club_id: OWNER_DIGEST_TEST_CLUB_A,
        club_name: "CLB A",
        access_level: "OWNER",
        can_manage_access: true,
        email: "must-not-be-consumed@test.invalid",
      }],
    }));
    await expect(source.listClubs()).resolves.toEqual([{
      id: OWNER_DIGEST_TEST_CLUB_A,
      name: "CLB A",
      accessLevel: "OWNER",
      canManageAccess: true,
    }]);
  });

  it("fails closed when the V2 function is not installed", async () => {
    const client: OwnerDailyDigestV2RpcClient = {
      rpc: async () => ({ data: null, error: { code: "42883" } }),
    };
    await expect(createOwnerDailyDigestV2Source(client).listClubs())
      .rejects.toThrow("OWNER_DIGEST_V2_BOUNDARY_NOT_LIVE");
  });

  it("sends only server-authorized identifiers for grant and regeneration", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client: OwnerDailyDigestV2RpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "request_owner_daily_digest_regeneration_v2") {
          return { data: { request_id: "f0000000-0000-4000-8000-000000000001" }, error: null };
        }
        return { data: "f0000000-0000-4000-8000-000000000002", error: null };
      },
    };
    const source = createOwnerDailyDigestV2Source(client);
    await source.grantManager(OWNER_DIGEST_TEST_CLUB_A, "c0000000-0000-4000-8000-000000000001");
    await source.requestRegeneration(
      OWNER_DIGEST_TEST_CLUB_A,
      "2026-08-10",
      "f0000000-0000-4000-8000-000000000003",
    );
    expect(calls).toEqual([
      {
        name: "grant_owner_daily_digest_manager_v2",
        args: {
          p_club_id: OWNER_DIGEST_TEST_CLUB_A,
          p_user_id: "c0000000-0000-4000-8000-000000000001",
          p_reason_code: "OWNER_UI",
        },
      },
      {
        name: "request_owner_daily_digest_regeneration_v2",
        args: {
          p_club_id: OWNER_DIGEST_TEST_CLUB_A,
          p_business_date: "2026-08-10",
          p_client_request_id: "f0000000-0000-4000-8000-000000000003",
          p_reason: "OWNER_UI_REGENERATION",
        },
      },
    ]);
  });
});

function clientWith(rows: Record<string, unknown>): OwnerDailyDigestV2RpcClient {
  return {
    rpc: async (name) => ({ data: rows[name] ?? null, error: null }),
  };
}
