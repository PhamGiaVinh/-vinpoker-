const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const CAPABILITY_KEYS = [
  "club_id",
  "can_owner",
  "can_floor",
  "can_cashier",
  "can_tracker",
  "can_dealer_control",
  "can_accountant",
  "can_chip_master",
  "can_marketer",
  "can_fnb_cashier",
  "can_fnb_server",
  "can_fnb_kitchen",
] as const;

const BOOLEAN_CAPABILITY_KEYS = CAPABILITY_KEYS.filter(
  (key): key is Exclude<(typeof CAPABILITY_KEYS)[number], "club_id"> => key !== "club_id",
);

export type OpsClubCapabilityRow = {
  club_id: string;
  can_owner: boolean;
  can_floor: boolean;
  can_cashier: boolean;
  can_tracker: boolean;
  can_dealer_control: boolean;
  can_accountant: boolean;
  can_chip_master: boolean;
  can_marketer: boolean;
  can_fnb_cashier: boolean;
  can_fnb_server: boolean;
  can_fnb_kitchen: boolean;
};

export type OpsGlobalCapability = {
  is_super_admin: boolean;
};

export type OpsSuperAdminClub = {
  club_id: string;
  club_name: string;
};

export class OpsCapabilityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsCapabilityContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OpsCapabilityContractError(`${label}: unexpected or missing fields`);
  }
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !POSTGRES_UUID_PATTERN.test(value)) {
    throw new OpsCapabilityContractError(`${label}: invalid uuid`);
  }
}

export function parseOpsCapabilityScope(value: unknown): OpsClubCapabilityRow[] {
  if (!Array.isArray(value)) {
    throw new OpsCapabilityContractError("scope: expected an array");
  }

  const seenClubIds = new Set<string>();
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new OpsCapabilityContractError(`scope[${index}]: expected an object`);
    }
    assertExactKeys(candidate, CAPABILITY_KEYS, `scope[${index}]`);
    assertUuid(candidate.club_id, `scope[${index}].club_id`);
    if (seenClubIds.has(candidate.club_id)) {
      throw new OpsCapabilityContractError(`scope[${index}]: duplicate club_id`);
    }
    seenClubIds.add(candidate.club_id);

    for (const key of BOOLEAN_CAPABILITY_KEYS) {
      if (typeof candidate[key] !== "boolean") {
        throw new OpsCapabilityContractError(`scope[${index}].${key}: expected boolean`);
      }
    }

    return candidate as OpsClubCapabilityRow;
  });
}

export function parseOpsGlobalCapability(value: unknown): OpsGlobalCapability {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new OpsCapabilityContractError("global: expected exactly one row");
  }
  assertExactKeys(value[0], ["is_super_admin"], "global[0]");
  if (typeof value[0].is_super_admin !== "boolean") {
    throw new OpsCapabilityContractError("global[0].is_super_admin: expected boolean");
  }
  return value[0] as OpsGlobalCapability;
}

export function parseOpsSuperAdminClubs(value: unknown): OpsSuperAdminClub[] {
  if (!Array.isArray(value)) {
    throw new OpsCapabilityContractError("super-admin clubs: expected an array");
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new OpsCapabilityContractError(`super-admin clubs[${index}]: expected an object`);
    }
    assertExactKeys(candidate, ["club_id", "club_name"], `super-admin clubs[${index}]`);
    assertUuid(candidate.club_id, `super-admin clubs[${index}].club_id`);
    if (typeof candidate.club_name !== "string" || candidate.club_name.trim().length === 0) {
      throw new OpsCapabilityContractError(`super-admin clubs[${index}].club_name: invalid name`);
    }
    if (seen.has(candidate.club_id)) {
      throw new OpsCapabilityContractError(`super-admin clubs[${index}]: duplicate club_id`);
    }
    seen.add(candidate.club_id);
    return candidate as OpsSuperAdminClub;
  });
}
