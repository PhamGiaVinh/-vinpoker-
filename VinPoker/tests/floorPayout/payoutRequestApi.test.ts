import { describe, expect, it, vi } from "vitest";
import {
  PayoutRequestApiError,
  createFloorPayoutRequest,
  getFloorPayoutRequestablePlaces,
  listPayoutRequests,
  payoutRequestErrorMessage,
} from "@/ops/payout/payoutRequestApi";

function clientReturning(data: unknown, error: { code?: string; message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    client: { rpc } as never,
    rpc,
  };
}

describe("Floor payout request API adapter", () => {
  it("uses the caller-bound requestable-places RPC and parses server values", async () => {
    const { client, rpc } = clientReturning({
      ok: true,
      places: [{
        finishedPlace: 1,
        entryId: "entry-1",
        recipientRef: "recipient-1",
        recipientName: "TEST Player",
        prizeId: "prize-1",
        prizeAmount: "1000000.00",
        fingerprint: "snapshot-1",
        isPaid: false,
        paymentId: null,
        pendingRequestId: null,
        pendingRequestedByMe: false,
        canRequest: true,
      }],
      integrityErrors: [],
    });

    const result = await getFloorPayoutRequestablePlaces(client, "tour-1");

    expect(rpc).toHaveBeenCalledWith("get_floor_payout_requestable_places", {
      p_tournament_id: "tour-1",
    });
    expect(result.places[0]).toMatchObject({
      finishedPlace: 1,
      prizeAmount: 1_000_000,
      canRequest: true,
    });
  });

  it("sends intent-only request fields and preserves the idempotency key", async () => {
    const { client, rpc } = clientReturning({
      ok: true,
      outcome: "created",
      requestId: "request-1",
      status: "pending",
    });

    await createFloorPayoutRequest(client, {
      tournamentId: "tour-1",
      finishedPlace: 2,
      method: "cash",
      notes: "handed over outside",
      idempotencyKey: "stable-key",
      expectedFingerprint: "0123456789abcdef0123456789abcdef",
    });

    expect(rpc).toHaveBeenCalledWith("create_tournament_prize_payment_request", {
      p_tournament_id: "tour-1",
      p_finished_place: 2,
      p_method: "cash",
      p_notes: "handed over outside",
      p_idempotency_key: "stable-key",
      p_expected_fingerprint: "0123456789abcdef0123456789abcdef",
    });
    const sentArgs = rpc.mock.calls[0][1];
    expect(sentArgs).not.toHaveProperty("prize_amount");
    expect(sentArgs).not.toHaveProperty("recipient_id");
    expect(sentArgs).not.toHaveProperty("club_id");
  });

  it("fails closed when the RPC returns a business error or malformed payload", async () => {
    const denied = clientReturning({
      ok: false,
      error: "floor_payout_grant_required",
    });
    await expect(getFloorPayoutRequestablePlaces(denied.client, "tour-1"))
      .rejects.toMatchObject({ code: "floor_payout_grant_required" });

    const malformed = clientReturning([]);
    await expect(getFloorPayoutRequestablePlaces(malformed.client, "tour-1"))
      .rejects.toBeInstanceOf(PayoutRequestApiError);

    const malformedFields = clientReturning({
      ok: true,
      places: [{
        finishedPlace: 1,
        entryId: "entry-1",
        recipientRef: null,
        recipientName: "TEST",
        prizeId: "prize-1",
        prizeAmount: null,
        fingerprint: "",
        isPaid: false,
        paymentId: null,
        pendingRequestId: null,
        pendingRequestedByMe: false,
        canRequest: true,
      }],
      integrityErrors: [],
    });
    await expect(getFloorPayoutRequestablePlaces(malformedFields.client, "tour-1"))
      .rejects.toMatchObject({ code: "invalid_server_response" });
  });

  it("surfaces snapshot comparison from the review queue without client recomputation", async () => {
    const { client } = clientReturning({
      ok: true,
      canReview: true,
      requests: [{
        id: "request-1",
        clubId: "club-1",
        tournamentId: "tour-1",
        tournamentName: "TEST",
        finishedPlace: 1,
        requestedBy: "floor-1",
        requesterName: "Floor A",
        method: "cash",
        notes: null,
        recipientName: "Old",
        prizeAmount: 100,
        snapshotFingerprint: "old",
        currentFingerprint: "new",
        snapshotMatches: false,
        currentRecipientName: "New",
        currentPrizeAmount: 200,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        decisionReason: null,
        paymentId: null,
        createdAt: "2026-07-31T00:00:00Z",
      }],
    });

    const result = await listPayoutRequests(client, "club-1", "pending");
    expect(result.requests[0]).toMatchObject({
      snapshotMatches: false,
      recipientName: "Old",
      currentRecipientName: "New",
      prizeAmount: 100,
      currentPrizeAmount: 200,
    });
  });

  it("maps sensitive failure modes to safe Vietnamese copy", () => {
    expect(payoutRequestErrorMessage(
      new PayoutRequestApiError("snapshot_changed"),
    )).toContain("đã thay đổi");
    expect(payoutRequestErrorMessage(
      new PayoutRequestApiError("invalid_server_response"),
    )).toContain("không hợp lệ");
  });
});
