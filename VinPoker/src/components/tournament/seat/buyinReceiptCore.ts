import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SeatReceiptData } from "./SeatReceipt";

export type BuyinReceiptSnapshot = {
  registration_id: string | null;
  receipt_code: string | null;
  qr_value: string | null;
  reference_code: string | null;
  status: string;
  club: {
    name: string | null;
    address: string | null;
    logo_url: string | null;
  };
  player_name: string | null;
  tournament_name: string | null;
  total_pay: number | null;
  completed_at: string | null;
  completed_at_source: "confirmed_at" | "issued_at" | null;
  table_number: number | null;
  seat_number: number | null;
  starting_stack: number | null;
};

export type BuyinReceiptLookup =
  | { registrationId: string; receiptCode?: never }
  | { receiptCode: string; registrationId?: never };

type BuyinReceiptResponse = { receipt?: BuyinReceiptSnapshot | null };
type ReceiptClient = SupabaseClient<Database>;

const isSnapshot = (value: unknown): value is BuyinReceiptSnapshot => {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.status === "string" && typeof receipt.club === "object";
};

/**
 * Fetches one server-authorized receipt snapshot through the caller's injected
 * application client. This keeps the shared receipt view usable in both
 * Player and Ops without coupling it to either browser session.
 */
export async function fetchBuyinReceiptWithClient(
  client: ReceiptClient,
  lookup: BuyinReceiptLookup,
): Promise<BuyinReceiptSnapshot | null> {
  const body = "registrationId" in lookup
    ? { registration_id: lookup.registrationId }
    : { receipt_code: lookup.receiptCode };
  const { data, error } = await client.functions.invoke("get-buyin-receipt", { body });
  if (error) return null;
  const receipt = (data as BuyinReceiptResponse | null)?.receipt;
  return isSnapshot(receipt) ? receipt : null;
}

/** Converts the read-only server snapshot into the shared print-safe view model. */
export function toSeatReceiptData(
  snapshot: BuyinReceiptSnapshot,
  fallback?: SeatReceiptData | null,
): SeatReceiptData {
  return {
    tournamentName: snapshot.tournament_name?.trim() || fallback?.tournamentName || "",
    playerName: snapshot.player_name?.trim() || fallback?.playerName || "",
    tableNumber: snapshot.table_number ?? fallback?.tableNumber ?? null,
    seatNumber: snapshot.seat_number ?? fallback?.seatNumber ?? null,
    receiptCode: snapshot.receipt_code ?? fallback?.receiptCode ?? "",
    qrValue: snapshot.qr_value ?? fallback?.qrValue ?? "",
    startingStack: snapshot.starting_stack ?? fallback?.startingStack ?? null,
    status: snapshot.status || fallback?.status || "confirmed",
    clubName: snapshot.club?.name?.trim() || fallback?.clubName || null,
    clubAddress: snapshot.club?.address?.trim() || fallback?.clubAddress || null,
    clubLogoUrl: snapshot.club?.logo_url?.trim() || fallback?.clubLogoUrl || null,
    totalPay: snapshot.total_pay ?? fallback?.totalPay ?? null,
    completedAt: snapshot.completed_at ?? fallback?.completedAt ?? null,
    completedAtSource: snapshot.completed_at_source ?? fallback?.completedAtSource ?? null,
    confirmationCode: snapshot.reference_code ?? fallback?.confirmationCode ?? null,
  };
}
