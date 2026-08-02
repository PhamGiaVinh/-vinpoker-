import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type OpsSupabaseClient = SupabaseClient<Database>;
type JsonObject = Record<string, unknown>;
type UntypedRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code?: string; message: string } | null;
}>;

export type PayoutRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "stale"
  | "superseded";

export type FloorRequestablePlace = {
  finishedPlace: number;
  entryId: string;
  recipientRef: string | null;
  recipientName: string;
  prizeId: string;
  prizeAmount: number;
  fingerprint: string;
  isPaid: boolean;
  paymentId: string | null;
  pendingRequestId: string | null;
  pendingRequestedByMe: boolean;
  canRequest: boolean;
};

export type PayoutRequestRow = {
  id: string;
  clubId: string;
  tournamentId: string;
  tournamentName: string;
  finishedPlace: number;
  requestedBy: string;
  requesterName: string;
  method: string | null;
  notes: string | null;
  recipientName: string;
  prizeAmount: number;
  snapshotFingerprint: string;
  currentFingerprint: string | null;
  snapshotMatches: boolean;
  currentRecipientName: string | null;
  currentPrizeAmount: number | null;
  status: PayoutRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  paymentId: string | null;
  createdAt: string;
};

export type FloorPayoutGrant = {
  floorUserId: string;
  displayName: string;
  enabled: boolean;
  grantedAt: string | null;
};

export class PayoutRequestApiError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.name = "PayoutRequestApiError";
    this.code = code;
  }
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PayoutRequestApiError("invalid_server_response");
  }
  return value as JsonObject;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PayoutRequestApiError("invalid_server_response");
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new PayoutRequestApiError("invalid_server_response");
  }
  return parsed;
}

function asStatus(value: unknown): PayoutRequestStatus {
  if (
    value === "pending"
    || value === "approved"
    || value === "rejected"
    || value === "cancelled"
    || value === "stale"
    || value === "superseded"
  ) {
    return value;
  }
  throw new PayoutRequestApiError("invalid_server_response");
}

async function invoke(
  client: OpsSupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<JsonObject> {
  // Generated types intentionally remain at the applied live schema. This
  // narrow adapter is removed only after the owner-gated migration is live and
  // types are regenerated; it does not claim that source-only RPCs exist live.
  const rpc = client.rpc as unknown as UntypedRpc;
  const { data, error } = await rpc(functionName, args);
  if (error) {
    throw new PayoutRequestApiError(error.code || "rpc_failed", error.message);
  }
  const payload = asObject(data);
  if (payload.ok !== true) {
    throw new PayoutRequestApiError(
      asString(payload.error, "request_failed"),
      asString(payload.error, "request_failed"),
    );
  }
  return payload;
}

export async function getFloorPayoutRequestablePlaces(
  client: OpsSupabaseClient,
  tournamentId: string,
): Promise<{
  places: FloorRequestablePlace[];
  integrityErrors: { finishedPlace: number; error: string }[];
}> {
  const payload = await invoke(client, "get_floor_payout_requestable_places", {
    p_tournament_id: tournamentId,
  });
  const rawPlaces = Array.isArray(payload.places) ? payload.places : [];
  const rawErrors = Array.isArray(payload.integrityErrors) ? payload.integrityErrors : [];

  return {
    places: rawPlaces.map((value) => {
      const row = asObject(value);
      return {
        finishedPlace: asNumber(row.finishedPlace),
        entryId: asRequiredString(row.entryId),
        recipientRef: asNullableString(row.recipientRef),
        recipientName: asString(row.recipientName, "Khách"),
        prizeId: asRequiredString(row.prizeId),
        prizeAmount: asNumber(row.prizeAmount),
        fingerprint: asRequiredString(row.fingerprint),
        isPaid: row.isPaid === true,
        paymentId: asNullableString(row.paymentId),
        pendingRequestId: asNullableString(row.pendingRequestId),
        pendingRequestedByMe: row.pendingRequestedByMe === true,
        canRequest: row.canRequest === true,
      };
    }),
    integrityErrors: rawErrors.map((value) => {
      const row = asObject(value);
      return {
        finishedPlace: asNumber(row.finishedPlace),
        error: asString(row.error, "snapshot_unavailable"),
      };
    }),
  };
}

export async function createFloorPayoutRequest(
  client: OpsSupabaseClient,
  input: {
    tournamentId: string;
    finishedPlace: number;
    method: "cash" | "bank" | "app" | "other" | null;
    notes: string | null;
    idempotencyKey: string;
    expectedFingerprint: string;
  },
): Promise<{ requestId: string; status: PayoutRequestStatus; outcome: string }> {
  const payload = await invoke(client, "create_tournament_prize_payment_request", {
    p_tournament_id: input.tournamentId,
    p_finished_place: input.finishedPlace,
    p_method: input.method,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
    p_expected_fingerprint: input.expectedFingerprint,
  });
  return {
    requestId: asRequiredString(payload.requestId),
    status: asStatus(payload.status),
    outcome: asString(payload.outcome),
  };
}

export async function cancelFloorPayoutRequest(
  client: OpsSupabaseClient,
  requestId: string,
): Promise<void> {
  await invoke(client, "cancel_tournament_prize_payment_request", {
    p_request_id: requestId,
  });
}

export async function listPayoutRequests(
  client: OpsSupabaseClient,
  clubId: string,
  status: PayoutRequestStatus | null,
): Promise<{ canReview: boolean; requests: PayoutRequestRow[] }> {
  const payload = await invoke(client, "list_tournament_prize_payment_requests", {
    p_club_id: clubId,
    p_status: status,
  });
  const rawRows = Array.isArray(payload.requests) ? payload.requests : [];
  return {
    canReview: payload.canReview === true,
    requests: rawRows.map((value) => {
      const row = asObject(value);
      return {
        id: asRequiredString(row.id),
        clubId: asRequiredString(row.clubId),
        tournamentId: asRequiredString(row.tournamentId),
        tournamentName: asString(row.tournamentName, "Giải đấu"),
        finishedPlace: asNumber(row.finishedPlace),
        requestedBy: asRequiredString(row.requestedBy),
        requesterName: asString(row.requesterName, "Floor"),
        method: asNullableString(row.method),
        notes: asNullableString(row.notes),
        recipientName: asString(row.recipientName, "Khách"),
        prizeAmount: asNumber(row.prizeAmount),
        snapshotFingerprint: asRequiredString(row.snapshotFingerprint),
        currentFingerprint: asNullableString(row.currentFingerprint),
        snapshotMatches: row.snapshotMatches === true,
        currentRecipientName: asNullableString(row.currentRecipientName),
        currentPrizeAmount: row.currentPrizeAmount == null ? null : asNumber(row.currentPrizeAmount),
        status: asStatus(row.status),
        reviewedBy: asNullableString(row.reviewedBy),
        reviewedAt: asNullableString(row.reviewedAt),
        decisionReason: asNullableString(row.decisionReason),
        paymentId: asNullableString(row.paymentId),
        createdAt: asRequiredString(row.createdAt),
      };
    }),
  };
}

export async function reviewPayoutRequest(
  client: OpsSupabaseClient,
  input: {
    requestId: string;
    decision: "approve" | "reject";
    reviewNote: string | null;
  },
): Promise<void> {
  await invoke(client, "review_tournament_prize_payment_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
}

export async function listFloorPayoutGrants(
  client: OpsSupabaseClient,
  clubId: string,
): Promise<FloorPayoutGrant[]> {
  const payload = await invoke(client, "list_floor_payout_request_grants", {
    p_club_id: clubId,
  });
  const rawRows = Array.isArray(payload.floors) ? payload.floors : [];
  return rawRows.map((value) => {
    const row = asObject(value);
    return {
      floorUserId: asRequiredString(row.floorUserId),
      displayName: asString(row.displayName, "Floor"),
      enabled: row.enabled === true,
      grantedAt: asNullableString(row.grantedAt),
    };
  });
}

export async function setFloorPayoutGrant(
  client: OpsSupabaseClient,
  input: { clubId: string; floorUserId: string; enabled: boolean },
): Promise<void> {
  await invoke(client, "set_floor_payout_request_grant", {
    p_club_id: input.clubId,
    p_floor_user_id: input.floorUserId,
    p_enabled: input.enabled,
  });
}

export function payoutRequestErrorMessage(error: unknown): string {
  const code = error instanceof PayoutRequestApiError ? error.code : "request_failed";
  const messages: Record<string, string> = {
    unauthorized: "Phiên Ops không còn hợp lệ. Hãy đăng nhập lại.",
    actor_not_allowed: "Tài khoản không có quyền thực hiện thao tác này.",
    floor_payout_grant_required: "Floor chưa được Owner cấp quyền đề nghị ghi nhận trả thưởng.",
    floor_membership_required: "Tài khoản không còn là Floor thật của CLB.",
    reviewer_must_differ: "Người duyệt phải khác người tạo đề nghị.",
    pending_request_exists: "Hạng này đã có một đề nghị đang chờ duyệt.",
    already_paid: "Hạng này đã được ghi nhận trả trước đó.",
    snapshot_changed: "Người nhận hoặc số tiền đã thay đổi. Hãy tạo đề nghị mới.",
    grant_or_membership_revoked: "Quyền Floor hoặc quyền đề nghị đã bị thu hồi.",
    request_not_pending: "Đề nghị không còn ở trạng thái chờ duyệt.",
    place_not_finalized: "Hạng này chưa có kết quả chính thức.",
    place_not_in_money: "Hạng này không nằm trong cơ cấu giải thưởng.",
    ambiguous_finished_place: "Kết quả hạng bị trùng. Cần kiểm tra dữ liệu trước khi tiếp tục.",
    ambiguous_prize_place: "Cơ cấu giải thưởng bị trùng hạng. Cần kiểm tra dữ liệu.",
    invalid_server_response: "Máy chủ trả về dữ liệu không hợp lệ. Không xác nhận thành công.",
  };
  return messages[code] ?? "Không hoàn tất được thao tác. Dữ liệu tiền thưởng chưa được thay đổi.";
}
