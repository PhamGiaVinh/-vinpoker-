import { describe, expect, it } from "vitest";
import { loadOpsRegistrationPaceQ0, loadOpsSepayReadStateQ0 } from "./opsQuantDataHealthAdapter";

const CLUB_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_CLUB_ID = "10000000-0000-4000-8000-000000000002";
const AS_OF = "2026-08-29T10:00:00.000Z";

function clientWith(data: unknown, error: { message?: string } | null = null) {
  return { rpc: async () => ({ data, error }) } as never;
}

describe("Ops Quant Data Health Q0 adapters", () => {
  it.each([CLUB_ID, "22222222-2222-2222-2222-222222222222"])("keeps exact cross-club checks for valid payloads requested by %s", async (clubId) => {
    const registration = {
      version: "ops-registration-observed-q0", clubId, asOf: AS_OF,
      window: { from: "2026-08-28T10:00:00.000Z", to: "2026-09-12T10:00:00.000Z" }, events: [],
    };
    const sepay = {
      version: "ops-sepay-read-state-q0", clubId, asOf: AS_OF,
      window: { from: "2026-08-28T10:00:00.000Z", to: AS_OF }, latestObservedTransactionAt: null,
      buckets: ["actionable", "resolved", "quarantined"].map((state) => ({ state, transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null })),
    };
    expect((await loadOpsRegistrationPaceQ0(clientWith(registration), clubId)).value?.events).toEqual([]);
    expect((await loadOpsSepayReadStateQ0(clientWith(sepay), clubId)).value?.buckets[0].transactionCount).toBe(0);
    expect(await loadOpsRegistrationPaceQ0(clientWith(registration), OTHER_CLUB_ID)).toMatchObject({ value: null, reasonCode: "REGISTRATION_PACE_READ_FAILED_MALFORMED" });
    expect(await loadOpsSepayReadStateQ0(clientWith(sepay), OTHER_CLUB_ID)).toMatchObject({ value: null, reasonCode: "SEPAY_READ_FAILED_MALFORMED" });
  });

  it("accepts an exact empty registration receipt for the requested club", async () => {
    const receipt = await loadOpsRegistrationPaceQ0(clientWith({
      version: "ops-registration-observed-q0",
      clubId: CLUB_ID,
      asOf: AS_OF,
      window: { from: "2026-08-28T10:00:00.000Z", to: "2026-09-12T10:00:00.000Z" },
      events: [],
    }), CLUB_ID);

    expect(receipt.value?.events).toEqual([]);
    expect(receipt.reasonCode).toBeNull();
  });

  it("fails closed when a valid payload belongs to another club", async () => {
    const receipt = await loadOpsSepayReadStateQ0(clientWith({
      version: "ops-sepay-read-state-q0",
      clubId: OTHER_CLUB_ID,
      asOf: AS_OF,
      window: { from: "2026-08-28T10:00:00.000Z", to: AS_OF },
      latestObservedTransactionAt: null,
      buckets: [],
    }), CLUB_ID);

    expect(receipt.value).toBeNull();
    expect(receipt.reasonCode).toBe("SEPAY_READ_FAILED_MALFORMED");
  });

  it("does not accept malformed RPC data or hide an RPC error", async () => {
    const malformed = await loadOpsRegistrationPaceQ0(clientWith({ clubId: CLUB_ID }), CLUB_ID);
    const failed = await loadOpsRegistrationPaceQ0(clientWith(null, { message: "owner scope denied" }), CLUB_ID);

    expect(malformed).toMatchObject({ value: null, reasonCode: "REGISTRATION_PACE_READ_FAILED_MALFORMED" });
    expect(failed).toMatchObject({ value: null, reasonCode: "owner scope denied" });
  });

  it.each([
    "SEPAY_ACCOUNT_MAPPING_MISSING",
    "SEPAY_ACCOUNT_MAPPING_AMBIGUOUS",
    "SEPAY_ACTIVE_CONFIG_ACCOUNT_CONFLICT",
    "SEPAY_STORED_CLUB_CONFLICT",
  ])("sanitizes the known SePay authority failure %s", async (reasonCode) => {
    const receipt = await loadOpsSepayReadStateQ0(clientWith(null, { message: `database error: ${reasonCode}: private detail` }), CLUB_ID);
    expect(receipt).toMatchObject({ value: null, reasonCode });
  });

  it("does not expose unknown PostgreSQL error text", async () => {
    const receipt = await loadOpsSepayReadStateQ0(clientWith(null, { message: "account 123456 is invalid" }), CLUB_ID);
    expect(receipt).toMatchObject({ value: null, reasonCode: "SEPAY_READ_FAILED" });
  });
});
