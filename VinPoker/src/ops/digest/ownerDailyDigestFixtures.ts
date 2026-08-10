import type { OwnerDailyDigestReadSource } from "@/ops/digest/ownerDailyDigestReadAdapter";

export const OWNER_DIGEST_TEST_CLUB_A = "10000000-0000-4000-8000-000000000001";
export const OWNER_DIGEST_TEST_CLUB_B = "10000000-0000-4000-8000-000000000002";

const TEST_ARTIFACTS = new Map<string, unknown>([
  [OWNER_DIGEST_TEST_CLUB_A, artifact({
    artifactId: "a0000000-0000-4000-8000-000000000001",
    clubId: OWNER_DIGEST_TEST_CLUB_A,
    registrations: 12,
    attendance: 12,
    entries: 12,
    staff: 2,
    rake: 1_200_000,
    fnb: 300_000,
    payout: 3_000_000,
    payroll: 1_500_000,
  })],
  [OWNER_DIGEST_TEST_CLUB_B, artifact({
    artifactId: "b0000000-0000-4000-8000-000000000002",
    clubId: OWNER_DIGEST_TEST_CLUB_B,
    registrations: 5,
    attendance: 5,
    entries: 5,
    staff: 1,
    rake: 250_000,
    fnb: 125_000,
    payout: 500_000,
    payroll: 700_000,
  })],
]);

export const ownerDailyDigestFixtureSource: OwnerDailyDigestReadSource = {
  async getLatest({ clubId }) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return TEST_ARTIFACTS.get(clubId) ?? null;
  },
};

function artifact(input: {
  artifactId: string;
  clubId: string;
  registrations: number;
  attendance: number;
  entries: number;
  staff: number;
  rake: number;
  fnb: number;
  payout: number;
  payroll: number;
}) {
  return Object.freeze({
    artifact_id: input.artifactId,
    club_id: input.clubId,
    artifact_type: "OWNER_DAILY_DIGEST",
    schema_version: 1,
    generated_at: "2026-08-10T03:05:00.000Z",
    content_payload: Object.freeze({
      business_date: "2026-08-10",
      freshness_state: "FRESH",
      money_state: "PROVISIONAL",
      metrics: Object.freeze({
        registrations: input.registrations,
        attendance: input.attendance,
        entries: input.entries,
        staff: input.staff,
        rake_retained_vnd: input.rake,
        fnb_net_revenue_vnd: input.fnb,
        pending_liabilities_vnd: input.payout,
        payroll_provisional_vnd: input.payroll,
      }),
      warning_codes: Object.freeze(["MONEY_PROVISIONAL", "LIABILITY_PENDING"]),
      action_codes: Object.freeze(["REVIEW_DAILY_CLOSE", "REVIEW_PENDING_LIABILITIES"]),
    }),
  });
}
