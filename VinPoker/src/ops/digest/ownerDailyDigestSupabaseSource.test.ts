import { describe, expect, it, vi } from "vitest";
import { createOwnerDailyDigestSupabaseSource } from "@/ops/digest/ownerDailyDigestSupabaseSource";

describe("Owner Daily Digest Supabase source", () => {
  it("calls only the owner-scoped snapshot RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { artifact_id: "artifact" }, error: null });
    const source = createOwnerDailyDigestSupabaseSource({ rpc });

    await expect(source.getLatest({
      clubId: "10000000-0000-4000-8000-000000000001",
      reportDate: "2026-08-10",
    })).resolves.toEqual({ artifact_id: "artifact" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_latest_owner_daily_digest_artifact", {
      p_club_id: "10000000-0000-4000-8000-000000000001",
      p_business_date: "2026-08-10",
    });
  });

  it.each(["42883", "42P01"])("maps missing read boundary %s to unavailable", async (code) => {
    const source = createOwnerDailyDigestSupabaseSource({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }),
    });
    await expect(source.getLatest({ clubId: "10000000-0000-4000-8000-000000000001" }))
      .rejects.toThrow("OWNER_DIGEST_READ_BOUNDARY_NOT_LIVE");
  });

  it("does not expose database error details", async () => {
    const source = createOwnerDailyDigestSupabaseSource({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "XX000" } }),
    });
    await expect(source.getLatest({ clubId: "10000000-0000-4000-8000-000000000001" }))
      .rejects.toThrow("OWNER_DIGEST_READ_FAILED");
  });
});
