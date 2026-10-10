import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeatReceiptData } from "./SeatReceipt";

export type FloorSeatTicketContext = { actorId: string; tournamentId: string; entryId: string };

/** Exact, server-authorized seat-ticket reader; no buy-in or client-stack fallback. */
export async function fetchFloorSeatTicketWithClient(
  client: Pick<SupabaseClient, "rpc">, context: FloorSeatTicketContext, receiptCode: string,
): Promise<SeatReceiptData> {
  if (!context.actorId || !context.tournamentId || !context.entryId || !receiptCode) throw new Error("Thiếu phạm vi phiếu chuyển ghế.");
  const { data, error } = await client.rpc("get_floor_seat_ticket_v1" as never, {
    p_tournament_id: context.tournamentId, p_entry_id: context.entryId, p_receipt_code: receiptCode,
  } as never);
  if (error) throw new Error(error.message);
  return parseFloorSeatTicket(data, context, receiptCode);
}

/** Locate an existing current ticket for the exact seat, then use the same proof. */
export async function fetchCurrentFloorSeatTicketWithClient(
  client: Pick<SupabaseClient, "rpc">, context: FloorSeatTicketContext, seatId: string,
): Promise<SeatReceiptData> {
  if (!context.actorId || !context.tournamentId || !context.entryId || !seatId) throw new Error("Thiếu phạm vi phiếu chuyển ghế.");
  const { data, error } = await client.rpc("get_current_floor_seat_ticket_v1" as never, {
    p_tournament_id: context.tournamentId, p_entry_id: context.entryId, p_seat_id: seatId,
  } as never);
  if (error) throw new Error(error.message);
  const value = data as Record<string, unknown> | null;
  if (value?.ok === true && (value.seat_id !== seatId || typeof value.receipt_code !== "string" || !value.receipt_code.trim()))
    throw new Error("Phiếu trả về không khớp ghế hiện hành.");
  return parseFloorSeatTicket(data, context, typeof value?.receipt_code === "string" ? value.receipt_code : "");
}

function parseFloorSeatTicket(data: unknown, context: FloorSeatTicketContext, receiptCode: string): SeatReceiptData {
  const value = data as Record<string, unknown> | null;
  if (value?.ok !== true) throw new Error(typeof value?.error === "string" ? value.error : "Không xác minh được phiếu chuyển ghế.");
  if (value.tournament_id !== context.tournamentId || value.entry_id !== context.entryId || value.receipt_code !== receiptCode
    || !["issued", "printed"].includes(String(value.status))
    || ![value.tournament_table_id, value.table_session_id, value.seat_id, value.player_name, value.tournament_name, value.issued_at]
      .every((field) => typeof field === "string" && field.trim().length > 0)
    || !Number.isSafeInteger(value.table_number) || !Number.isSafeInteger(value.seat_number) || (value.seat_number as number) < 1
    || !Number.isSafeInteger(value.stack_at_issue) || (value.stack_at_issue as number) < 0) {
    throw new Error("Phiếu trả về không khớp entry hoặc phiên bàn.");
  }
  return { tournamentName: value.tournament_name as string, playerName: value.player_name as string,
    tableNumber: value.table_number as number, seatNumber: value.seat_number as number,
    receiptCode, qrValue: receiptCode, startingStack: value.stack_at_issue as number,
    status: value.status as string, completedAt: value.issued_at as string, completedAtSource: "issued_at",
    floorSeatContext: context };
}
