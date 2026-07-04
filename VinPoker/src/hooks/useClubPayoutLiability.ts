import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Read-only tournament prize payout liability for the owner's clubs (W3-B).
// Owed = derived from finalized finished_place × tournament_prizes (matches get_member_history).
// Paid = paid-to-date from the tournament_prize_payments ledger. Liability = owed − paid.
// Two-tier gate: while the migration is source-only (RPC absent), the RPC 42883/42P01s → the hook
// reports `notApplied` (NOT a generic error) so the tab degrades to "chưa áp dụng" + mock.
// `types.ts` regen is a separate post-apply commit → call via `(supabase as any).rpc`.

export interface ClubPayoutLiabilityTournament {
  tournamentId: string;
  name: string;
  closeDate: string | null;
  isClosed: boolean;
  hasFinishedPlace: boolean;
  owed: number | null;
  paid: number;
  outstanding: number | null;
  finishersCount: number;
}

export interface ClubPayoutLiability {
  periodFrom: string;
  periodTo: string;
  owedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  perTournament: ClubPayoutLiabilityTournament[];
  aging: { d0_1: number; d2_7: number; d8p: number };
}

export interface PayoutLiabilityQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  clubFilter: string; // "all" | clubId
}

export function useClubPayoutLiability({ from, to, clubFilter }: PayoutLiabilityQuery) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notApplied, setNotApplied] = useState(false);
  const [data, setData] = useState<ClubPayoutLiability | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotApplied(false);
    const fromTs = new Date(from + "T00:00:00").toISOString();
    const toTs = new Date(to + "T23:59:59").toISOString();
    try {
      const { data: d, error: rpcErr } = await (supabase as any).rpc("get_club_payout_liability", {
        p_from: fromTs,
        p_to: toTs,
        p_club_id: clubFilter !== "all" ? clubFilter : null,
      });
      if (rpcErr) {
        // 42883 = undefined_function, 42P01 = undefined_table → migration not applied yet.
        if (rpcErr.code === "42883" || rpcErr.code === "42P01") {
          setNotApplied(true);
          setData(null);
          return;
        }
        setError(rpcErr.message ?? "Lỗi tải phải-trả-giải");
        setData(null);
        return;
      }
      setData((d ?? null) as ClubPayoutLiability | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải phải-trả-giải");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, clubFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, error, notApplied, data, reload: load };
}
