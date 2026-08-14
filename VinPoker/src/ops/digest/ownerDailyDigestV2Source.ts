import {
  OwnerDailyDigestReadError,
  parseOwnerDailyDigestArtifact,
  type OwnerDailyDigestReport,
} from "@/ops/digest/ownerDailyDigestReadAdapter";

type RpcResult = {
  data: unknown | null;
  error: { code?: string | null } | null;
};

export type OwnerDailyDigestV2RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type DigestAccessLevel = "OWNER" | "MANAGER" | "SUPER_ADMIN";

export type OwnerDailyDigestV2Club = {
  id: string;
  name: string;
  accessLevel: DigestAccessLevel;
  canManageAccess: boolean;
};

export type OwnerDailyDigestManager = {
  userId: string;
  displayName: string;
  shortIdentifier: string;
  grantedAt?: string;
};

export type DigestGenerationState = {
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  resultCode: string | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type OwnerDailyDigestV2LoadResult = {
  report: OwnerDailyDigestReport | null;
  requestedBusinessDate: string | null;
  latestAvailableBusinessDate: string | null;
  lastGeneration: DigestGenerationState | null;
};

export interface OwnerDailyDigestV2Source {
  listClubs(): Promise<OwnerDailyDigestV2Club[]>;
  loadSnapshot(input: { clubId: string; reportDate?: string }): Promise<OwnerDailyDigestV2LoadResult>;
  listManagers(clubId: string): Promise<OwnerDailyDigestManager[]>;
  listCandidates(clubId: string): Promise<OwnerDailyDigestManager[]>;
  grantManager(clubId: string, userId: string): Promise<void>;
  revokeManager(clubId: string, userId: string): Promise<void>;
  requestRegeneration(clubId: string, reportDate: string, clientRequestId: string): Promise<string>;
}

export function createOwnerDailyDigestV2Source(client: OwnerDailyDigestV2RpcClient): OwnerDailyDigestV2Source {
  return {
    async listClubs() {
      const data = await call(client, "list_owner_daily_digest_clubs_v2");
      return parseClubs(data);
    },
    async loadSnapshot({ clubId, reportDate }) {
      const data = await call(client, "get_owner_daily_digest_snapshot_v2", {
        p_club_id: clubId,
        p_business_date: reportDate ?? null,
      });
      return parseEnvelope(data, clubId, reportDate);
    },
    async listManagers(clubId) {
      return parseManagers(await call(client, "list_owner_daily_digest_managers_v2", { p_club_id: clubId }), true);
    },
    async listCandidates(clubId) {
      return parseManagers(await call(client, "list_assignable_owner_daily_digest_managers_v2", { p_club_id: clubId }), false);
    },
    async grantManager(clubId, userId) {
      await call(client, "grant_owner_daily_digest_manager_v2", {
        p_club_id: clubId,
        p_user_id: userId,
        p_reason_code: "OWNER_UI",
      });
    },
    async revokeManager(clubId, userId) {
      await call(client, "revoke_owner_daily_digest_manager_v2", {
        p_club_id: clubId,
        p_user_id: userId,
        p_reason_code: "OWNER_UI",
      });
    },
    async requestRegeneration(clubId, reportDate, clientRequestId) {
      const data = asRecord(await call(client, "request_owner_daily_digest_regeneration_v2", {
        p_club_id: clubId,
        p_business_date: reportDate,
        p_client_request_id: clientRequestId,
        p_reason: "OWNER_UI_REGENERATION",
      }), "OWNER_DIGEST_GENERATION_RESPONSE_MALFORMED");
      return uuid(data.request_id, "OWNER_DIGEST_GENERATION_RESPONSE_MALFORMED");
    },
  };
}

async function call(client: OwnerDailyDigestV2RpcClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (!error) return data;
  if (error.code === "42883" || error.code === "42P01") {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_V2_BOUNDARY_NOT_LIVE");
  }
  if (error.code === "42501") throw new OwnerDailyDigestReadError("OWNER_DIGEST_FORBIDDEN");
  if (error.code === "22023" || error.code === "23514" || error.code === "54000" || error.code === "55000") {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_REQUEST_REJECTED");
  }
  throw new OwnerDailyDigestReadError("OWNER_DIGEST_V2_REQUEST_FAILED");
}

function parseEnvelope(value: unknown, clubId: string, reportDate?: string): OwnerDailyDigestV2LoadResult {
  const row = asRecord(value, "OWNER_DIGEST_ENVELOPE_MALFORMED");
  const requestedBusinessDate = nullableDate(row.requested_business_date);
  const latestAvailableBusinessDate = nullableDate(row.latest_available_business_date);
  const report = row.snapshot === null ? null : parseOwnerDailyDigestArtifact(row.snapshot);
  if (report && report.clubId !== clubId) throw new OwnerDailyDigestReadError("OWNER_DIGEST_CROSS_CLUB_RESPONSE");
  if (reportDate && report?.reportDate !== reportDate) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_REPORT_DATE_MISMATCH");
  }
  if (reportDate && requestedBusinessDate !== reportDate) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_REPORT_DATE_MISMATCH");
  }
  return {
    report,
    requestedBusinessDate,
    latestAvailableBusinessDate,
    lastGeneration: row.last_generation === null ? null : parseGeneration(row.last_generation),
  };
}

function parseGeneration(value: unknown): DigestGenerationState {
  const row = asRecord(value, "OWNER_DIGEST_GENERATION_STATE_MALFORMED");
  return {
    status: enumValue(row.status, ["RUNNING", "SUCCESS", "FAILED", "SKIPPED"] as const),
    resultCode: nullableCode(row.result_code),
    errorCode: nullableCode(row.error_code),
    startedAt: dateTime(row.started_at),
    completedAt: row.completed_at === null ? null : dateTime(row.completed_at),
  };
}

function parseClubs(value: unknown): OwnerDailyDigestV2Club[] {
  if (!Array.isArray(value)) throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
  const seen = new Set<string>();
  return value.map((item) => {
    const row = asRecord(item, "OWNER_DIGEST_SCOPE_MALFORMED");
    const id = uuid(row.club_id, "OWNER_DIGEST_SCOPE_MALFORMED");
    if (seen.has(id)) throw new OwnerDailyDigestReadError("OWNER_DIGEST_SCOPE_MALFORMED");
    seen.add(id);
    return {
      id,
      name: text(row.club_name, 160, "OWNER_DIGEST_SCOPE_MALFORMED"),
      accessLevel: enumValue(row.access_level, ["OWNER", "MANAGER", "SUPER_ADMIN"] as const),
      canManageAccess: boolean(row.can_manage_access, "OWNER_DIGEST_SCOPE_MALFORMED"),
    };
  });
}

function parseManagers(value: unknown, withGrantedAt: boolean): OwnerDailyDigestManager[] {
  if (!Array.isArray(value)) throw new OwnerDailyDigestReadError("OWNER_DIGEST_MANAGER_LIST_MALFORMED");
  const seen = new Set<string>();
  return value.map((item) => {
    const row = asRecord(item, "OWNER_DIGEST_MANAGER_LIST_MALFORMED");
    const userId = uuid(row.user_id, "OWNER_DIGEST_MANAGER_LIST_MALFORMED");
    if (seen.has(userId)) throw new OwnerDailyDigestReadError("OWNER_DIGEST_MANAGER_LIST_MALFORMED");
    seen.add(userId);
    return {
      userId,
      displayName: text(row.display_name, 160, "OWNER_DIGEST_MANAGER_LIST_MALFORMED"),
      shortIdentifier: shortIdentifier(row.short_identifier),
      ...(withGrantedAt ? { grantedAt: dateTime(row.granted_at) } : {}),
    };
  });
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OwnerDailyDigestReadError(code);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value;
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_DATE_MALFORMED");
  }
  return value;
}

function dateTime(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_DATE_TIME_MALFORMED");
  }
  return value;
}

function text(value: unknown, maxLength: number, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new OwnerDailyDigestReadError(code);
  }
  return value.trim();
}

function shortIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}$/iu.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_MANAGER_LIST_MALFORMED");
  }
  return value.toLowerCase();
}

function boolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new OwnerDailyDigestReadError(code);
  return value;
}

function nullableCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Z0-9_]{2,96}$/u.test(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_GENERATION_STATE_MALFORMED");
  }
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new OwnerDailyDigestReadError("OWNER_DIGEST_ENUM_MALFORMED");
  }
  return value as T[number];
}
