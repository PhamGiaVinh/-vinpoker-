import {
  OwnerDailyDigestReadError,
  type OwnerDailyDigestReadSource,
} from "@/ops/digest/ownerDailyDigestReadAdapter";

type DigestRpcResult = {
  data: unknown | null;
  error: { code?: string | null } | null;
};

export type OwnerDailyDigestRpcClient = {
  rpc(
    name: "get_latest_owner_daily_digest_artifact",
    args: { p_club_id: string; p_business_date?: string },
  ): PromiseLike<DigestRpcResult>;
};

export function createOwnerDailyDigestSupabaseSource(
  client: OwnerDailyDigestRpcClient,
): OwnerDailyDigestReadSource {
  return {
    async getLatest({ clubId, reportDate }) {
      const { data, error } = await client.rpc("get_latest_owner_daily_digest_artifact", {
        p_club_id: clubId,
        ...(reportDate ? { p_business_date: reportDate } : {}),
      });

      if (!error) return data;
      if (error.code === "42883" || error.code === "42P01") {
        throw new OwnerDailyDigestReadError("OWNER_DIGEST_READ_BOUNDARY_NOT_LIVE");
      }
      if (error.code === "42501") {
        throw new OwnerDailyDigestReadError("OWNER_DIGEST_FORBIDDEN");
      }
      throw new OwnerDailyDigestReadError("OWNER_DIGEST_READ_FAILED");
    },
  };
}
