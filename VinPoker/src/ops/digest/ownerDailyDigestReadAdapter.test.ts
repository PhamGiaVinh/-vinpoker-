import { describe, expect, it } from "vitest";
import {
  loadOwnerDailyDigestReport,
  OwnerDailyDigestReadError,
  parseOwnerDailyDigestArtifact,
} from "@/ops/digest/ownerDailyDigestReadAdapter";
import {
  OWNER_DIGEST_TEST_CLUB_A,
  OWNER_DIGEST_TEST_CLUB_B,
  ownerDailyDigestFixtureSource,
} from "@/ops/digest/ownerDailyDigestFixtures";

const LEGACY_POSTGRES_CLUB = "20000000-0000-0000-0000-000000000003";

describe("Owner Daily Digest read adapter", () => {
  it("reproduces the canonical TEST values without recalculating", async () => {
    const a = await loadOwnerDailyDigestReport(ownerDailyDigestFixtureSource, { clubId: OWNER_DIGEST_TEST_CLUB_A });
    const b = await loadOwnerDailyDigestReport(ownerDailyDigestFixtureSource, { clubId: OWNER_DIGEST_TEST_CLUB_B });
    expect(a).toMatchObject({
      registrations: 12,
      attendance: 12,
      entries: 12,
      staffCount: 2,
      rakeAmount: 1_200_000,
      fnbAmount: 300_000,
      outstandingPayoutAmount: 3_000_000,
      provisionalPayrollAmount: 1_500_000,
      moneyState: "PROVISIONAL",
    });
    expect(b).toMatchObject({
      registrations: 5,
      attendance: 5,
      entries: 5,
      staffCount: 1,
      rakeAmount: 250_000,
      fnbAmount: 125_000,
      outstandingPayoutAmount: 500_000,
      provisionalPayrollAmount: 700_000,
      moneyState: "PROVISIONAL",
    });
  });

  it("rejects a cross-club artifact before returning it to the view", async () => {
    const artifact = await ownerDailyDigestFixtureSource.getLatest({ clubId: OWNER_DIGEST_TEST_CLUB_A });
    await expect(loadOwnerDailyDigestReport({ getLatest: async () => artifact }, { clubId: OWNER_DIGEST_TEST_CLUB_B }))
      .rejects.toEqual(new OwnerDailyDigestReadError("OWNER_DIGEST_CROSS_CLUB_RESPONSE"));
  });

  it("keeps a real zero distinct from malformed or unavailable data", async () => {
    const artifact = await ownerDailyDigestFixtureSource.getLatest({ clubId: OWNER_DIGEST_TEST_CLUB_A });
    const copy = structuredClone(artifact) as { content_payload: { metrics: { fnb_net_revenue_vnd: number } } };
    copy.content_payload.metrics.fnb_net_revenue_vnd = 0;
    expect(parseOwnerDailyDigestArtifact(copy).fnbAmount).toBe(0);
    copy.content_payload.metrics.fnb_net_revenue_vnd = -1;
    expect(() => parseOwnerDailyDigestArtifact(copy)).toThrow("OWNER_DIGEST_AMOUNT_MALFORMED");
  });

  it("accepts a legacy PostgreSQL UUID in a canonical digest artifact", async () => {
    const artifact = await ownerDailyDigestFixtureSource.getLatest({ clubId: OWNER_DIGEST_TEST_CLUB_A });
    const copy = structuredClone(artifact) as { club_id: string };
    copy.club_id = LEGACY_POSTGRES_CLUB;

    expect(parseOwnerDailyDigestArtifact(copy).clubId).toBe(LEGACY_POSTGRES_CLUB);
  });
});
