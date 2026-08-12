import { OwnerDailyDigestReadError } from "@/ops/digest/ownerDailyDigestReadAdapter";

export type OwnerDailyDigestClubOption = {
  id: string;
  name: string;
};

type ClubScopeRpcResult = {
  data: unknown | null;
  error: { code?: string | null } | null;
};

export type OwnerDailyDigestClubScopeRpcClient = {
  rpc(name: "list_owner_daily_digest_clubs"): PromiseLike<ClubScopeRpcResult>;
};

export interface OwnerDailyDigestClubScopeSource {
  listClubs(): Promise<OwnerDailyDigestClubOption[]>;
}

export function createOwnerDailyDigestClubScopeSource(
  client: OwnerDailyDigestClubScopeRpcClient,
): OwnerDailyDigestClubScopeSource {
  return {
    async listClubs() {
      const { data, error } = await client.rpc("list_owner_daily_digest_clubs");
      if (error) {
        if (error.code === "42883") {
          throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_BOUNDARY_NOT_LIVE");
        }
        if (error.code === "42501") {
          throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_FORBIDDEN");
        }
        throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_READ_FAILED");
      }
      return parseClubOptions(data);
    },
  };
}

function parseClubOptions(value: unknown): OwnerDailyDigestClubOption[] {
  if (!Array.isArray(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
  }

  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
    }
    const row = item as Record<string, unknown>;
    const id = uuid(row.club_id);
    const name = clubName(row.club_name);
    if (seen.has(id)) {
      throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
    }
    seen.add(id);
    return { id, name };
  });
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
  }
  return value;
}

function clubName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
  }
  return value;
}
