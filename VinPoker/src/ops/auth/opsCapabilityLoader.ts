import {
  parseOpsCapabilityScope,
  parseOpsGlobalCapability,
  parseOpsSuperAdminClubs,
  type OpsClubCapabilityRow,
  type OpsGlobalCapability,
  type OpsSuperAdminClub,
} from "@/ops/auth/opsCapabilityContract";

export type OpsCapabilitySource = "unified" | "legacy";

type OpsRpcError = { code?: string; message?: string };
type OpsRpcResult = Promise<{ data: unknown; error: OpsRpcError | null }>;

export type OpsRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => OpsRpcResult;
};

export type LoadedOpsCapabilities = {
  scope: OpsClubCapabilityRow[];
  global: OpsGlobalCapability;
  source: OpsCapabilitySource;
};

const LEGACY_KEYS = ["club_id", "can_owner", "can_cashier", "can_floor"] as const;

function parseLegacyScope(value: unknown): OpsClubCapabilityRow[] {
  if (!Array.isArray(value)) throw new Error("legacy scope: expected an array");
  const seen = new Set<string>();
  const mapped = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`legacy scope[${index}]: expected an object`);
    }
    const row = candidate as Record<string, unknown>;
    const keys = Object.keys(row).sort();
    if (keys.join("|") !== [...LEGACY_KEYS].sort().join("|")) {
      throw new Error(`legacy scope[${index}]: unexpected or missing fields`);
    }
    if (typeof row.club_id !== "string" || seen.has(row.club_id)) {
      throw new Error(`legacy scope[${index}]: invalid or duplicate club_id`);
    }
    for (const key of ["can_owner", "can_cashier", "can_floor"] as const) {
      if (typeof row[key] !== "boolean") throw new Error(`legacy scope[${index}].${key}: expected boolean`);
    }
    seen.add(row.club_id);
    return {
      club_id: row.club_id,
      can_owner: row.can_owner as boolean,
      can_floor: row.can_floor as boolean,
      can_cashier: row.can_cashier as boolean,
      can_tracker: false,
      can_dealer_control: false,
      can_accountant: false,
      can_chip_master: false,
      can_marketer: false,
      can_fnb_cashier: false,
      can_fnb_server: false,
      can_fnb_kitchen: false,
    };
  });
  return parseOpsCapabilityScope(mapped);
}

function rpcError(label: string, error: OpsRpcError): Error {
  const result = new Error(`${label}: ${error.code ?? "RPC_ERROR"}`);
  result.name = "OpsCapabilityRpcError";
  return result;
}

function isFreshJwtClockSkew(error: OpsRpcError | null): boolean {
  return error?.code === "PGRST303"
    && typeof error.message === "string"
    && /jwt issued at future/iu.test(error.message);
}

async function loadUnifiedScopeWithOneClockSkewRetry(client: OpsRpcClient) {
  const first = await client.rpc("get_my_ops_capability_scope");
  if (!isFreshJwtClockSkew(first.error)) return first;

  // A freshly-issued browser token can briefly precede the REST gateway clock
  // in a local/disposable stack. Retry only this identified, non-authority
  // error once; every other error remains fail-closed below.
  await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  return client.rpc("get_my_ops_capability_scope");
}

export async function loadOpsCapabilities(client: OpsRpcClient): Promise<LoadedOpsCapabilities> {
  const scopeResult = await loadUnifiedScopeWithOneClockSkewRetry(client);
  if (scopeResult.error?.code === "42883") {
    const legacyResult = await client.rpc("get_my_floor_operator_scope");
    if (legacyResult.error) throw rpcError("legacy capability", legacyResult.error);
    return {
      scope: parseLegacyScope(legacyResult.data ?? []),
      global: { is_super_admin: false },
      source: "legacy",
    };
  }
  if (scopeResult.error) throw rpcError("unified capability", scopeResult.error);

  const scope = parseOpsCapabilityScope(scopeResult.data ?? []);
  const globalResult = await client.rpc("get_my_ops_global_capability");
  if (globalResult.error) throw rpcError("global capability", globalResult.error);
  return {
    scope,
    global: parseOpsGlobalCapability(globalResult.data),
    source: "unified",
  };
}

export async function loadSuperAdminClubPage(
  client: OpsRpcClient,
  input: { search?: string; afterName?: string; afterId?: string; limit?: number },
): Promise<OpsSuperAdminClub[]> {
  const result = await client.rpc("list_ops_clubs_for_super_admin", {
    p_search: input.search?.trim() || null,
    p_after_name: input.afterName ?? null,
    p_after_id: input.afterId ?? null,
    p_limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
  });
  if (result.error) throw rpcError("super-admin clubs", result.error);
  return parseOpsSuperAdminClubs(result.data ?? []);
}

export async function verifySuperAdminClub(
  client: OpsRpcClient,
  clubId: string,
): Promise<OpsSuperAdminClub | null> {
  const clubs = await loadSuperAdminClubPage(client, { search: clubId, limit: 1 });
  return clubs.find((club) => club.club_id === clubId) ?? null;
}
