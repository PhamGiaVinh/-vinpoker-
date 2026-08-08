import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type OpsClient = SupabaseClient<Database>;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function mutationError(error: unknown, data?: unknown): Error {
  const record = asRecord(data);
  const code = typeof record?.error === "string" ? record.error : null;
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error && typeof error.message === "string"
      ? error.message
      : null;
  return new Error(code ?? message ?? "Thao tác không thành công. Máy chủ không xác nhận kết quả.");
}

export function assertMutationOk(data: unknown, error?: unknown): JsonRecord {
  if (error) throw mutationError(error, data);
  const record = asRecord(data);
  if (record && record.ok === false) throw mutationError(null, record);
  if (record && (record.error || record.success === false)) throw mutationError(null, record);
  return record ?? {};
}

export async function createTournament(client: OpsClient, input: {
  clubId: string;
  name: string;
  startTime: string;
  buyIn: number;
  startingStack: number;
  minutesPerLevel: number;
  lateRegCloseLevel: number;
  gameType?: string;
  rakeAmount?: number;
  serviceFeeAmount?: number;
}): Promise<JsonRecord> {
  const { data, error } = await client.from("tournaments").insert({
    club_id: input.clubId,
    name: input.name.trim(),
    start_time: input.startTime,
    buy_in: input.buyIn,
    starting_stack: input.startingStack,
    minutes_per_level: input.minutesPerLevel,
    late_reg_close_level: input.lateRegCloseLevel,
    game_type: input.gameType ?? "nlh",
    rake_amount: input.rakeAmount ?? 0,
    service_fee_amount: input.serviceFeeAmount ?? 0,
    status: "upcoming",
    live_status: "upcoming",
    current_level: 1,
    players_remaining: 0,
  }).select("id").single();
  if (error) throw mutationError(error);
  return { ok: true, tournament_id: data.id };
}

export async function updateTournament(client: OpsClient, tournamentId: string, patch: {
  name?: string;
  startTime?: string;
  buyIn?: number;
  startingStack?: number;
  minutesPerLevel?: number;
  lateRegCloseLevel?: number;
}): Promise<JsonRecord> {
  const update: Database["public"]["Tables"]["tournaments"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.startTime !== undefined) update.start_time = patch.startTime;
  if (patch.buyIn !== undefined) update.buy_in = patch.buyIn;
  if (patch.startingStack !== undefined) update.starting_stack = patch.startingStack;
  if (patch.minutesPerLevel !== undefined) update.minutes_per_level = patch.minutesPerLevel;
  if (patch.lateRegCloseLevel !== undefined) update.late_reg_close_level = patch.lateRegCloseLevel;
  const { error } = await client.from("tournaments").update(update).eq("id", tournamentId);
  if (error) throw mutationError(error);
  return { ok: true, tournament_id: tournamentId };
}

export async function updateTournamentLive(client: OpsClient, input: {
  tournamentId: string;
  status: string;
  playersRemaining: number;
  level: number;
  blinds?: string | null;
}): Promise<JsonRecord> {
  const state = await client.rpc("update_tournament_state", {
    p_tournament_id: input.tournamentId,
    p_status: input.status,
    p_reason: "ops_floor_live_update",
  });
  assertMutationOk(state.data, state.error);
  const { error } = await client.from("tournaments").update({
    players_remaining: input.playersRemaining,
    current_level: input.level,
    current_blinds: input.blinds ?? null,
    live_status: input.status,
  }).eq("id", input.tournamentId);
  if (error) throw mutationError(error);
  return { ok: true, tournament_id: input.tournamentId };
}

export async function closeTournament(client: OpsClient, tournamentId: string): Promise<JsonRecord> {
  const { data, error } = await client.rpc("close_tournament", {
    p_tournament_id: tournamentId,
    p_reason: "ops_floor_close",
  });
  return assertMutationOk(data, error);
}

export async function deleteTournament(client: OpsClient, tournamentId: string): Promise<JsonRecord> {
  const { error } = await client.from("tournaments").delete().eq("id", tournamentId);
  if (error) throw mutationError(error);
  return { ok: true, tournament_id: tournamentId };
}

export async function confirmRegistration(client: OpsClient, input: {
  registrationId: string;
  actorUserId: string;
  drawMode?: string;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("confirm_registration_and_assign_seat", {
    p_registration_id: input.registrationId,
    p_actor_user_id: input.actorUserId,
    p_draw_mode: input.drawMode ?? "random_balanced",
  });
  return assertMutationOk(data, error);
}

export async function confirmOfflineBuyIn(client: OpsClient, input: {
  tournamentId: string;
  playerName: string;
  phone?: string;
  buyIn: number;
  fee: number;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("create_offline_buyin_and_seat", {
    p_tournament_id: input.tournamentId,
    p_player_name: input.playerName.trim(),
    p_phone: input.phone?.trim() || undefined,
    p_buy_in: input.buyIn,
    p_fee: input.fee,
    p_draw_mode: "random_balanced",
  });
  return assertMutationOk(data, error);
}

export async function confirmSepay(client: OpsClient, input: {
  bankTransactionId: string;
  registrationId: string;
  reason?: string;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("manual_confirm_bank_transaction", {
    p_bank_transaction_id: input.bankTransactionId,
    p_registration_id: input.registrationId,
    p_reason: input.reason?.trim() || undefined,
  });
  return assertMutationOk(data, error);
}

export async function ignoreSepay(client: OpsClient, input: { bankTransactionId: string; reason: string }): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ignore_bank_transaction", {
    p_bank_transaction_id: input.bankTransactionId,
    p_reason: input.reason.trim(),
  });
  return assertMutationOk(data, error);
}

export async function confirmStaking(client: OpsClient, input: { purchaseId: string; bankTxId?: string; note?: string }): Promise<JsonRecord> {
  const { data, error } = await client.functions.invoke("admin-confirm-funded", {
    body: {
      purchase_id: input.purchaseId,
      bank_tx_id: input.bankTxId?.trim() || undefined,
      note: input.note?.trim() || undefined,
    },
  });
  return assertMutationOk(data, error);
}

export async function reviewVerification(client: OpsClient, input: {
  requestId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("approve_verification", {
    p_request_id: input.requestId,
    p_action: input.action,
    p_rejection_reason: input.rejectionReason?.trim() || undefined,
  });
  return assertMutationOk(data, error);
}
