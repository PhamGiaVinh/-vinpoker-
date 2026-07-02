import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";

// ── Guest QR ordering (GQR) — the ANON data layer for /fnb/order?t=<token> ─────────────────────
// All three RPCs are SECURITY DEFINER + GRANTed to anon (migration 20261111000018): the supabase
// client works sessionless here (anon key, no login). Every fact derives from the secret per-table
// token in the QR URL — the club is never taken from the client.

export type FnbGuestCategory = { id: string; name: string; sort_order: number };
export type FnbGuestItem = {
  id: string; category_id: string | null; name: string; price_vnd: number;
  image_url: string | null; sort_order: number;
};
export type FnbGuestLookup = {
  club_name: string; table_name: string; bank_available: boolean;
  categories: FnbGuestCategory[]; items: FnbGuestItem[];
};
export type FnbGuestBank = {
  bank_name: string | null; bank_bin: string | null;
  account_number: string; account_holder: string | null; qr_code_url: string | null;
};
export type FnbGuestCreateResult = {
  order_id: string; idempotent: boolean; subtotal_vnd: number;
  payment_method: "cash" | "bank_transfer"; reference_code: string | null;
  expires_at: string; bank: FnbGuestBank | null;
};
export type FnbGuestOrderStatus = {
  order: {
    id: string; order_status: "pending" | "paid" | "shipped" | "cancelled" | "expired";
    subtotal_vnd: number; payment_method: "cash" | "bank_transfer";
    reference_code: string | null; guest_seat: number | null;
    created_at: string; paid_at: string | null; expires_at: string;
  };
  bank: FnbGuestBank | null;
};

/** Token → "Bạn đang ở Bàn X" + the club's active menu. Errors carry the RPC's {error:CODE}. */
export function useFnbGuestLookup(token: string | null) {
  return useQuery({
    queryKey: ["fnb", "guest", "lookup", token],
    enabled: !!token && FEATURES.fnbGuestOrder,
    retry: 1,
    queryFn: async (): Promise<FnbGuestLookup> => {
      const { data, error } = await (supabase.rpc as any)("fnb_guest_lookup", { p_token: token });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      return res as FnbGuestLookup;
    },
  });
}

/** Create the guest order (cash or bank). Parent owns UI state; errors surface via mapFnbError. */
export async function fnbGuestCreateOrder(args: {
  token: string; seat: number | null; customerName: string | null; note: string | null;
  lines: { menu_item_id: string; qty: number }[];
  paymentMethod: "cash" | "bank_transfer"; clientRequestId: string;
}): Promise<{ res: FnbGuestCreateResult | null; errorCode: string | null }> {
  const { data, error } = await (supabase.rpc as any)("fnb_guest_create_order", {
    p_token: args.token,
    p_seat: args.seat,
    p_customer_name: args.customerName,
    p_note: args.note,
    p_lines: args.lines,
    p_payment_method: args.paymentMethod,
    p_client_request_id: args.clientRequestId,
  });
  const res = data as any;
  if (error) return { res: null, errorCode: error.message ?? "unknown" };
  if (res?.error) return { res: null, errorCode: res.error };
  return { res: res as FnbGuestCreateResult, errorCode: null };
}

/** Poll one order's status (pending → paid → shipped | expired | cancelled). 4s while waiting. */
export function useFnbGuestOrderStatus(token: string | null, orderId: string | null) {
  return useQuery({
    queryKey: ["fnb", "guest", "status", token, orderId],
    enabled: !!token && !!orderId && FEATURES.fnbGuestOrder,
    refetchInterval: (q) => {
      const st = (q.state.data as FnbGuestOrderStatus | undefined)?.order?.order_status;
      return st === "pending" || st === "paid" ? 4000 : false; // stop once terminal (shipped/expired/cancelled)
    },
    queryFn: async (): Promise<FnbGuestOrderStatus> => {
      const { data, error } = await (supabase.rpc as any)("fnb_guest_order_status", {
        p_token: token, p_order_id: orderId,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      return res as FnbGuestOrderStatus;
    },
  });
}
