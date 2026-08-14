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
import { ownerDailyDigestV2FixtureSource } from "@/ops/digest/ownerDailyDigestV2Fixtures";

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

  it("reads the canonical V2 snapshot including service fee and revision", async () => {
    const result = await ownerDailyDigestV2FixtureSource.loadSnapshot({ clubId: OWNER_DIGEST_TEST_CLUB_A });
    expect(result.report).toMatchObject({
      schemaVersion: 2,
      snapshotVersion: 3,
      calculationVersion: "owner-daily-digest-v2.0.0",
      registrations: 42,
      rakeAmount: 12_600_000,
      serviceFeeAmount: 2_550_000,
      fnbAmount: 4_780_000,
      outstandingPayoutAmount: 38_000_000,
      provisionalPayrollAmount: 7_300_000,
    });
  });

  it("keeps V2 unavailable money sources as null instead of zero", async () => {
    const result = await ownerDailyDigestV2FixtureSource.loadSnapshot({ clubId: OWNER_DIGEST_TEST_CLUB_B });
    expect(result.report?.serviceFeeAmount).toBeNull();
    expect(result.report?.provisionalPayrollAmount).toBeNull();
    expect(result.report?.fnbAmount).toBe(1_260_000);
    expect(result.report?.freshnessState).toBe("PARTIAL");
  });
});
