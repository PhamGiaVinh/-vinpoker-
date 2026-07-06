import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Read-only per-place payout recipients for a tournament (W3-B2, cashier "Đã trả thưởng").
// Server-derived (SECDEF) list of IN-MONEY finished places with recipient name (resolved exactly
// as the write RPC does), prize amount, and paid status from the tournament_prize_payments ledger.
// Two-tier gate: while the read RPC is source-only (absent) it 42883/42P01s → `notApplied` (NOT a
// generic error) so the section degrades to "Cần áp dụng" instead of crashing. The WRITE
// (record_tournament_prize_payment) is already live; this only gates the LIST.
// `types.ts` regen is a separate post-apply commit → call via `(supabase as any).rpc`.

export interface PayoutRecipientPlace {
  finishedPlace: number;
  recipientName: string;
  prizeAmount: number;
  isPaid: boolean;
  paidAt: string | null;
  method: string | null;
}

export interface TournamentPayoutRecipients {
  tournamentId: string;
  itmPlaces: number | null;
  owedTotal: number;
  paidTotal: number;
  paidCount: number;
  totalCount: number;
  places: PayoutRecipientPlace[];
}

export function useTournamentPayoutRecipients(tournamentId: string | null | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notApplied, setNotApplied] = useState(false);
  const [data, setData] = useState<TournamentPayoutRecipients | null>(null);

  const load = useCallback(async () => {
    if (!tournamentId) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotApplied(false);
    try {
      const { data: d, error: rpcErr } = await (supabase as any).rpc(
        "get_tournament_payout_recipients",
        { p_tournament_id: tournamentId },
      );
      if (rpcErr) {
        // 42883 = undefined_function, 42P01 = undefined_table → migration not applied yet.
        if (rpcErr.code === "42883" || rpcErr.code === "42P01") {
          setNotApplied(true);
          setData(null);
          return;
        }
        setError(rpcErr.message ?? "Lỗi tải danh sách trả thưởng");
        setData(null);
        return;
      }
      setData((d ?? null) as TournamentPayoutRecipients | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải danh sách trả thưởng");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, error, notApplied, data, reload: load };
}
