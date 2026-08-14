import type {
  OwnerDailyDigestManager,
  OwnerDailyDigestV2Source,
} from "@/ops/digest/ownerDailyDigestV2Source";
import {
  OWNER_DIGEST_TEST_CLUB_A,
  OWNER_DIGEST_TEST_CLUB_B,
} from "@/ops/digest/ownerDailyDigestFixtures";

const manager: OwnerDailyDigestManager = {
  userId: "c0000000-0000-4000-8000-000000000001",
  displayName: "Quản lý ca sáng",
  shortIdentifier: "00000001",
};
const candidate: OwnerDailyDigestManager = {
  userId: "c0000000-0000-4000-8000-000000000002",
  displayName: "Quản lý ca tối",
  shortIdentifier: "00000002",
};

let managers = [{ ...manager, grantedAt: "2026-08-10T04:00:00.000Z" }];
let candidates = [{ ...candidate }];

const artifacts = new Map<string, unknown>([
  [OWNER_DIGEST_TEST_CLUB_A, artifact({
    id: "d0000000-0000-4000-8000-000000000001",
    clubId: OWNER_DIGEST_TEST_CLUB_A,
    registrations: 42,
    attendance: 37,
    entries: 51,
    staff: 18,
    rake: 12_600_000,
    serviceFee: 2_550_000,
    fnb: 4_780_000,
    payout: 38_000_000,
    payroll: 7_300_000,
  })],
  [OWNER_DIGEST_TEST_CLUB_B, artifact({
    id: "d0000000-0000-4000-8000-000000000002",
    clubId: OWNER_DIGEST_TEST_CLUB_B,
    registrations: 17,
    attendance: 14,
    entries: 21,
    staff: 9,
    rake: 4_100_000,
    serviceFee: null,
    fnb: 1_260_000,
    payout: 8_000_000,
    payroll: null,
  })],
]);

export const ownerDailyDigestV2FixtureSource: OwnerDailyDigestV2Source = {
  async listClubs() {
    return [
      { id: OWNER_DIGEST_TEST_CLUB_A, name: "CLB thử nghiệm A", accessLevel: "OWNER", canManageAccess: true },
      { id: OWNER_DIGEST_TEST_CLUB_B, name: "CLB thử nghiệm B", accessLevel: "MANAGER", canManageAccess: false },
    ];
  },
  async loadSnapshot({ clubId, reportDate }) {
    await wait();
    const raw = reportDate && reportDate !== "2026-08-10" ? null : artifacts.get(clubId) ?? null;
    const { parseOwnerDailyDigestArtifact } = await import("@/ops/digest/ownerDailyDigestReadAdapter");
    return {
      report: raw ? parseOwnerDailyDigestArtifact(raw) : null,
      requestedBusinessDate: reportDate ?? null,
      latestAvailableBusinessDate: raw ? "2026-08-10" : "2026-08-10",
      lastGeneration: reportDate === "2026-08-09" ? {
        status: "FAILED",
        resultCode: "GENERATION_FAILED",
        errorCode: "SOURCE_UNAVAILABLE",
        startedAt: "2026-08-10T00:00:00.000Z",
        completedAt: "2026-08-10T00:00:02.000Z",
      } : null,
    };
  },
  async listManagers() {
    await wait();
    return managers.map((item) => ({ ...item }));
  },
  async listCandidates() {
    await wait();
    return candidates.map((item) => ({ ...item }));
  },
  async grantManager(_clubId, userId) {
    const found = candidates.find((item) => item.userId === userId);
    if (!found) throw new Error("OWNER_DIGEST_REQUEST_REJECTED");
    managers = [...managers, { ...found, grantedAt: new Date().toISOString() }];
    candidates = candidates.filter((item) => item.userId !== userId);
  },
  async revokeManager(_clubId, userId) {
    const found = managers.find((item) => item.userId === userId);
    if (!found) return;
    candidates = [...candidates, { userId: found.userId, displayName: found.displayName, shortIdentifier: found.shortIdentifier }];
    managers = managers.filter((item) => item.userId !== userId);
  },
  async requestRegeneration() {
    await wait();
    return "e0000000-0000-4000-8000-000000000001";
  },
};

function artifact(input: {
  id: string;
  clubId: string;
  registrations: number;
  attendance: number;
  entries: number;
  staff: number;
  rake: number | null;
  serviceFee: number | null;
  fnb: number | null;
  payout: number;
  payroll: number | null;
}) {
  const hash = "a".repeat(64);
  return {
    artifact_id: input.id,
    club_id: input.clubId,
    artifact_type: "OWNER_DAILY_DIGEST",
    schema_version: 2,
    snapshot_version: 3,
    calculation_version: "owner-daily-digest-v2.0.0",
    privacy_class: "NO_PII",
    sensitivity: "CLUB_CONFIDENTIAL",
    source_data_hash: hash,
    generation_mode: "DETERMINISTIC",
    input_hash: hash,
    output_hash: hash,
    source_as_of: "2026-08-11T00:02:00.000Z",
    generated_at: "2026-08-11T00:03:00.000Z",
    approval_status: "NOT_REQUIRED",
    content_sha256: hash,
    expires_at: "2026-08-11T08:03:00.000Z",
    content_payload: {
      business_date: "2026-08-10",
      calculation_version: "owner-daily-digest-v2.0.0",
      effective_timezone: "Asia/Bangkok",
      window_start_utc: "2026-08-09T23:00:00.000Z",
      window_end_utc: "2026-08-10T23:00:00.000Z",
      freshness_state: input.serviceFee === null || input.payroll === null ? "PARTIAL" : "FRESH",
      money_state: "PROVISIONAL",
      metrics: {
        registered_players: available(input.registrations),
        attendance_players: available(input.attendance),
        entries_count: available(input.entries),
        staff_count: available(input.staff),
        rake_paid_vnd: metric(input.rake),
        service_fee_paid_vnd: metric(input.serviceFee),
        fnb_net_revenue_vnd: metric(input.fnb),
        payout_outstanding_vnd: metric(input.payout),
        dealer_payroll_outstanding_vnd: metric(input.payroll),
      },
      warning_codes: input.payout > 0 ? ["PAYOUT_OUTSTANDING"] : [],
      action_codes: input.payout > 0 ? ["REVIEW_PAYOUT_OUTSTANDING"] : [],
    },
  };
}

function available(value: number) {
  return { value, state: "AVAILABLE" };
}

function metric(value: number | null) {
  return value === null ? { value: null, state: "UNAVAILABLE" } : available(value);
}

function wait() {
  return new Promise((resolve) => window.setTimeout(resolve, 100));
}
