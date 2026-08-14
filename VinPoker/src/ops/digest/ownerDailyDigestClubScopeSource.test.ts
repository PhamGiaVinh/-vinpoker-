import { describe, expect, it, vi } from "vitest";
import {
  createOwnerDailyDigestClubScopeSource,
} from "@/ops/digest/ownerDailyDigestClubScopeSource";

const CLUB_A = "10000000-0000-4000-8000-000000000001";
const CLUB_B = "10000000-0000-4000-8000-000000000002";
const LEGACY_POSTGRES_CLUB = "20000000-0000-0000-0000-000000000003";

describe("Owner Daily Digest Club scope source", () => {
  it("uses only the server-scoped Club list RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { club_id: CLUB_A, club_name: "CLB A" },
        { club_id: CLUB_B, club_name: "CLB B" },
      ],
      error: null,
    });
    const source = createOwnerDailyDigestClubScopeSource({ rpc });

    await expect(source.listClubs()).resolves.toEqual([
      { id: CLUB_A, name: "CLB A" },
      { id: CLUB_B, name: "CLB B" },
    ]);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("list_owner_daily_digest_clubs");
  });

  it("accepts a legacy PostgreSQL UUID returned by the canonical RPC", async () => {
    const source = createOwnerDailyDigestClubScopeSource({
      rpc: vi.fn().mockResolvedValue({
        data: [{ club_id: LEGACY_POSTGRES_CLUB, club_name: "CLB legacy" }],
        error: null,
      }),
    });

    await expect(source.listClubs()).resolves.toEqual([
      { id: LEGACY_POSTGRES_CLUB, name: "CLB legacy" },
    ]);
  });

  it.each(["42883", "42501", "XX000"])("does not expose raw scope errors (%s)", async (code) => {
    const source = createOwnerDailyDigestClubScopeSource({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }),
    });

    await expect(source.listClubs()).rejects.toThrow(/^OWNER_DIGEST_SCOPE_/u);
  });

  it("rejects malformed or duplicated server scope rows", async () => {
    const source = createOwnerDailyDigestClubScopeSource({
      rpc: vi.fn().mockResolvedValue({
        data: [
          { club_id: CLUB_A, club_name: "CLB A" },
          { club_id: CLUB_A, club_name: "CLB A lặp" },
        ],
        error: null,
      }),
    });

    await expect(source.listClubs()).rejects.toThrow("OWNER_DIGEST_SCOPE_MALFORMED");
  });
});
