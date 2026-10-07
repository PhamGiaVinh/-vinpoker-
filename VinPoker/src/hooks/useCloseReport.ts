import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeCloseReport,
  type CloseReportInput,
  type CloseReportTotals,
  type CloseReportSource,
} from "@/lib/closeReport";
import {
  describeCloseBlockers, getTournamentCloseReadiness,
  type TournamentCloseReadiness, withServerCloseTotals,
} from "@/lib/feltLifecycleReadiness";

// Read-layer + finalize for the operator Close Report (Chốt giải).
// The reconciliation math lives in the pure ./lib/closeReport; this hook only
// fetches the immutable inputs (confirmed registrations + recorded eliminations)
// and, on lock, calls the audited source-only `close_tournament` RPC.
//
// NOTE: `close_tournament` and `tournament_close_report` are source-only (migration
// 20261213000000, owner-gated apply) so they are not in the generated Supabase types
// yet — cast to `any` (the same pattern the codebase uses for not-yet-applied objects,
// e.g. media_club_ids). The caller must gate all of this behind FEATURES.closeReport,
// so nothing here runs until both the flag is ON and the schema is applied.

function classifySource(referenceCode: string | null | undefined): CloseReportSource {
  const rc = (referenceCode ?? "").toUpperCase();
  if (rc.startsWith("REENTRY")) return "reentry";
  if (rc.startsWith("CASH")) return "offline";
  return "online";
}

export interface CloseTournamentResult {
  ok: boolean;
  error?: string;
  reconciled?: boolean;
  clubRevenue?: number;
}

export function useCloseReport(tournamentId: string | null | undefined) {
  const [report, setReport] = useState<CloseReportTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyClosed, setAlreadyClosed] = useState(false);
  const [readiness, setReadiness] = useState<TournamentCloseReadiness | null>(null);
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    if (!tournamentId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setReadiness(null);
    try {
      const [regsRes, elimsRes, serverReadiness] = await Promise.all([
        supabase
          .from("tournament_registrations")
          .select("buy_in, total_pay, reference_code, status")
          .eq("tournament_id", tournamentId)
          .eq("status", "confirmed"),
        supabase
          .from("tournament_eliminations")
          .select("position, prize")
          .eq("tournament_id", tournamentId),
        getTournamentCloseReadiness(tournamentId),
      ]);

      if (regsRes.error) throw regsRes.error;
      if (elimsRes.error) throw elimsRes.error;
      if (!serverReadiness.ok) throw new Error(serverReadiness.error ?? "readiness_failed");

      const input: CloseReportInput = {
        entries: (regsRes.data ?? []).map((r) => {
          const buyIn = Number(r.buy_in ?? 0);
          const totalPay = Number(r.total_pay ?? 0);
          return {
            totalPay,
            buyIn,
            // Combined club revenue (rake + service) attributed to one bucket; the
            // server snapshot computes the identical figure via Σ(total_pay − buy_in).
            rakeCharged: Math.max(0, totalPay - buyIn),
            serviceCharged: 0,
            source: classifySource(r.reference_code),
            usedFreeRake: false,
          };
        }),
        payouts: (elimsRes.data ?? []).map((e) => ({
          position: Number(e.position ?? 0),
          prize: Number(e.prize ?? 0),
        })),
      };

      const computed = computeCloseReport(input);
      if (seq !== requestSeq.current) return;
      // The server's close_tournament RPC owns these amounts. The old client
      // projection clamped negative revenue and could disagree with its report.
      setReport(withServerCloseTotals(computed, serverReadiness));
      setReadiness(serverReadiness);
      setAlreadyClosed(serverReadiness.alreadyClosed);
    } catch (caught) {
      if (seq !== requestSeq.current) return;
      setError(caught instanceof Error ? caught.message : "load_failed");
      setReport(null);
      setReadiness(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const closeTournament = useCallback(
    async (reason?: string): Promise<CloseTournamentResult> => {
      if (!tournamentId) return { ok: false, error: "no_tournament" };
      requestSeq.current += 1;
      setLoading(false);
      let current: TournamentCloseReadiness;
      try {
        current = await getTournamentCloseReadiness(tournamentId);
      } catch (caught) {
        return { ok: false, error: caught instanceof Error ? caught.message : "readiness_failed" };
      }
      setReadiness(current);
      if (!current.ok) return { ok: false, error: current.error ?? "readiness_failed" };
      if (current.alreadyClosed) return { ok: false, error: "Giải đã được chốt trước đó." };
      if (!current.ready) {
        return { ok: false, error: `Còn việc cần xử lý: ${describeCloseBlockers(current.blockers)}` };
      }
      const { data, error: rpcErr } = await supabase.rpc("close_tournament", {
        p_tournament_id: tournamentId,
        p_reason: reason ?? null,
      });
      const res = data as
        | { ok?: boolean; error?: string; outcome?: string; reconciled?: boolean; club_revenue?: number }
        | null;
      if (rpcErr || !res?.ok) {
        return { ok: false, error: res?.error ?? rpcErr?.message ?? "close_failed" };
      }
      setAlreadyClosed(true);
      setReadiness({ ...current, alreadyClosed: true });
      return { ok: true, reconciled: res.reconciled, clubRevenue: res.club_revenue };
    },
    [tournamentId],
  );

  return { report, loading, error, alreadyClosed, readiness, reload, closeTournament };
}
