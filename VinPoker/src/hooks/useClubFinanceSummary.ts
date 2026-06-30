import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import {
  normalizeStatus, isUnpaid, agingBucket, daysBetween, monthKey,
  type PayrollStatusKey, type AgingBucketKey,
} from "@/lib/clubFinance";

// Read-only money-flow summary for one club (owner) or all clubs (super_admin).
// NEVER recomputes payroll — reads SAVED dealer_payroll values only.
//
// Phase 3: prefers the server RPC `get_club_finance_summary` (one RLS-checked call that
// also reads payment_records for accurate paid/reconciled/aging). If the RPC is not applied
// yet / errors, it transparently FALLS BACK to the original client-side aggregation below —
// so the dashboard works at every step with zero regression.

export interface ClubFinanceSummary {
  revenue: {
    // staking stream (kept separate from tournament rake)
    stakingFees: number; stakingFixed: number; stakingPercent: number; stakingArchive: number;
    payoutFees: number;
    // tournament rake stream — `rake` = CONFIGURED (rake_amount × paying entries); `rakeActual`
    // (Σ total_pay − buy_in) is reconciliation only; splits are configured per source.
    rake: number; rakeActual: number; rakeExpected: number; rakeVariance: number;
    rakeOnline: number; rakeOffline: number; rakeReentry: number;
    // service fee stream (phí dịch vụ) — CONFIGURED (service_fee_amount × paying entries), separate from rake
    serviceFee: number;
    total: number;
    fnb: number;
  };
  cost: { payrollNet: number; payrollGross: number; adjustments: number; fnbCogs: number; compCogs: number };
  net: number;
  statusTotals: Record<PayrollStatusKey, number>;
  unpaidTotal: number;
  reconciledTotal: number;
  aging: Record<AgingBucketKey, number>;
  trend: { key: string; revenue: number; cost: number }[];
  perPeriod: { id: string; clubId: string; clubName: string; periodKey: string; gross: number; net: number; status: PayrollStatusKey }[];
  perClub: { clubId: string; name: string; revenue: number; cost: number; net: number }[];
}

const ARCHIVE_DEFAULT = 199000;
const CHUNK = 200;

const emptyStatusTotals = (): Record<PayrollStatusKey, number> => ({
  draft: 0, submitted: 0, approved: 0, locked: 0, payment_prepared: 0,
  paid: 0, reconciled: 0, rejected: 0, other: 0,
});
const emptyAging = (): Record<AgingBucketKey, number> => ({ d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 });

const emptyRevenue = (): ClubFinanceSummary["revenue"] => ({
  stakingFees: 0, stakingFixed: 0, stakingPercent: 0, stakingArchive: 0, payoutFees: 0,
  rake: 0, rakeActual: 0, rakeExpected: 0, rakeVariance: 0,
  rakeOnline: 0, rakeOffline: 0, rakeReentry: 0, serviceFee: 0, total: 0, fnb: 0,
});

// Normalize a server `revenue` object, defaulting fields the OLD (pre-v2) RPC body
// does not return — so the dashboard degrades gracefully until v2 is applied live.
// `rake` is the headline straight from the server (CONFIGURED in v2; the count-based
// estimate in the old RPC — both are the intended price, so it maps through directly).
// rakeActual/Expected fall back to `rake`, splits to 0, staking sub-fees collapse into
// the lumped `stakingFees`.
const normRevenue = (rev: any): ClubFinanceSummary["revenue"] => {
  const r = rev ?? {};
  const rake = Number(r.rake ?? 0);
  const stakingFees = Number(r.stakingFees ?? 0);
  return {
    stakingFees,
    stakingFixed: Number(r.stakingFixed ?? stakingFees),
    stakingPercent: Number(r.stakingPercent ?? 0),
    stakingArchive: Number(r.stakingArchive ?? 0),
    payoutFees: Number(r.payoutFees ?? 0),
    rake,
    rakeActual: Number(r.rakeActual ?? rake),
    rakeExpected: Number(r.rakeExpected ?? rake),
    rakeVariance: Number(r.rakeVariance ?? 0),
    rakeOnline: Number(r.rakeOnline ?? 0),
    rakeOffline: Number(r.rakeOffline ?? 0),
    rakeReentry: Number(r.rakeReentry ?? 0),
    serviceFee: Number(r.serviceFee ?? 0),
    total: Number(r.total ?? 0),
    fnb: Number(r.fnb ?? 0),
  };
};

const emptySummary = (): ClubFinanceSummary => ({
  revenue: emptyRevenue(),
  cost: { payrollNet: 0, payrollGross: 0, adjustments: 0, fnbCogs: 0, compCogs: 0 },
  net: 0,
  statusTotals: emptyStatusTotals(),
  unpaidTotal: 0,
  reconciledTotal: 0,
  aging: emptyAging(),
  trend: [],
  perPeriod: [],
  perClub: [],
});

export interface FinanceQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  clubFilter: string; // "all" | clubId (admin only)
}

export function useClubFinanceSummary({ from, to, clubFilter }: FinanceQuery) {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [summary, setSummary] = useState<ClubFinanceSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fromTs = new Date(from + "T00:00:00").toISOString();
    const toTs = new Date(to + "T23:59:59").toISOString();

    // ===== Phase 3: server RPC first (accurate payment state, single RLS-checked call) =====
    try {
      const { data, error: rpcErr } = await (supabase as any).rpc("get_club_finance_summary", {
        p_from: fromTs,
        p_to: toTs,
        p_club_id: clubFilter !== "all" ? clubFilter : null,
      });
      const d = data as any;
      if (!rpcErr && d && typeof d === "object" && d.revenue && d.cost) {
        setClubs(Array.isArray(d.clubs) ? d.clubs : []);
        setSummary({
          revenue: normRevenue(d.revenue),
          cost: { payrollNet: Number(d.cost?.payrollNet ?? 0), payrollGross: Number(d.cost?.payrollGross ?? 0), adjustments: Number(d.cost?.adjustments ?? 0), fnbCogs: Number(d.cost?.fnbCogs ?? 0), compCogs: Number(d.cost?.compCogs ?? 0) },
          net: Number(d.net ?? 0),
          statusTotals: { ...emptyStatusTotals(), ...(d.statusTotals ?? {}) },
          unpaidTotal: Number(d.unpaidTotal ?? 0),
          reconciledTotal: Number(d.reconciledTotal ?? 0),
          aging: { ...emptyAging(), ...(d.aging ?? {}) },
          trend: Array.isArray(d.trend) ? d.trend : [],
          perPeriod: Array.isArray(d.perPeriod) ? d.perPeriod : [],
          perClub: Array.isArray(d.perClub) ? d.perClub : [],
        });
        setLoading(false);
        return;
      }
      // rpcErr (e.g. function not applied yet) → fall through to client-side aggregation
    } catch {
      // network/unknown → fall through to client-side aggregation
    }

    // ===== Fallback: client-side aggregation (works before the RPC is applied) =====
    try {
      const nowMs = Date.now();

      // ---- scope (mirror FeeRevenueDashboard: owner → owned clubs; admin → all) ----
      let clubList: { id: string; name: string }[] = [];
      let scopedIds: string[] | null = null; // null => admin, all clubs
      if (isAdmin) {
        const { data } = await supabase.from("clubs").select("id, name").order("name");
        clubList = (data ?? []).map((c) => ({ id: c.id, name: c.name }));
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) { setClubs([]); setSummary(emptySummary()); setLoading(false); return; }
        const { data } = await supabase.from("clubs").select("id, name").eq("owner_id", uid);
        clubList = (data ?? []).map((c) => ({ id: c.id, name: c.name }));
        scopedIds = clubList.map((c) => c.id);
        if (scopedIds.length === 0) { setClubs([]); setSummary(emptySummary()); setLoading(false); return; }
      }
      setClubs(clubList);
      const clubName = new Map(clubList.map((c) => [c.id, c.name]));

      // effective club restriction (a specific club filter overrides the owner scope)
      const restrictIds: string[] | null = clubFilter !== "all" ? [clubFilter] : scopedIds;
      const inScope = (clubId: string | null | undefined): boolean =>
        !!clubId && (restrictIds === null ? true : restrictIds.includes(clubId));

      const rev = new Map<string, number>();
      const cost = new Map<string, number>();
      const revMonth = new Map<string, number>();
      const costMonth = new Map<string, number>();
      const addRev = (c: string, v: number, mk: string) => {
        rev.set(c, (rev.get(c) ?? 0) + v);
        revMonth.set(mk, (revMonth.get(mk) ?? 0) + v);
      };

      let stakingFees = 0, stakingFixed = 0, stakingPercent = 0, stakingArchive = 0, payoutFees = 0;
      let rake = 0, rakeExpected = 0, rakeActual = 0, rakeOnline = 0, rakeOffline = 0, rakeReentry = 0, serviceFee = 0;
      const svcOn = FEATURES.tournamentServiceFee;

      // ===== Revenue 1 — staking platform fees (fixed + percent on check-in, archive on completed) =====
      {
        let q = supabase.from("staking_deals")
          .select("club_id, status, platform_fixed_fee, platform_percent_fee, platform_archive_fee, result_prize_vnd, player_checked_in, created_at")
          .gte("created_at", fromTs).lte("created_at", toTs).limit(5000);
        if (restrictIds) q = q.in("club_id", restrictIds);
        const { data, error: e } = await q;
        if (e) throw e;
        (data ?? []).forEach((d) => {
          if (!inScope(d.club_id)) return;
          const checkedIn = !!d.player_checked_in;
          const entryFee = Number(d.platform_fixed_fee ?? 0);
          const percentFee = Number((d as any).platform_percent_fee ?? 0);
          const archiveFee = Number(d.platform_archive_fee ?? ARCHIVE_DEFAULT);
          const entry = checkedIn && entryFee > 0 ? entryFee : 0;
          const percent = checkedIn && percentFee > 0 ? percentFee : 0;
          const prize = Number(d.result_prize_vnd ?? 0);
          const archive = d.status === "completed" && prize > 0 ? Math.min(archiveFee, prize) : 0;
          stakingFixed += entry; stakingPercent += percent; stakingArchive += archive;
          const v = entry + percent + archive;
          if (v > 0) { stakingFees += v; addRev(d.club_id!, v, monthKey(d.created_at)); }
        });
      }

      // ===== Revenue 2 — staking payout fees (payout_recipients.platform_fee_vnd, club via deal) =====
      {
        const { data: prs, error: e } = await supabase.from("payout_recipients")
          .select("platform_fee_vnd, deal_id, created_at")
          .gte("created_at", fromTs).lte("created_at", toTs).limit(5000);
        if (e) throw e;
        const dealIds = Array.from(new Set((prs ?? []).map((p) => p.deal_id)));
        const dealClub = new Map<string, string | null>();
        for (let i = 0; i < dealIds.length; i += CHUNK) {
          const chunk = dealIds.slice(i, i + CHUNK);
          if (!chunk.length) break;
          const { data: ds } = await supabase.from("staking_deals").select("id, club_id").in("id", chunk);
          (ds ?? []).forEach((d) => dealClub.set(d.id, d.club_id));
        }
        (prs ?? []).forEach((p) => {
          const c = dealClub.get(p.deal_id) ?? null;
          if (!inScope(c)) return;
          const v = Number(p.platform_fee_vnd ?? 0);
          if (v > 0) { payoutFees += v; addRev(c!, v, monthKey(p.created_at)); }
        });
      }

      // ===== Revenue 3 — tournament rake (CONFIGURED model) =====
      //   Tournament rake is a single fixed price per tour (tournaments.rake_amount), identical for
      //   online & offline. HEADLINE rake = rake_amount × paying confirmed entries, split by source via
      //   reference_code prefix (REENTRY-=re-entry, CASH-=offline, else=online); free-rake slots apply to
      //   ONLINE only. rakeActual = Σ GREATEST(0, total_pay − buy_in) is carried for RECONCILIATION only
      //   (uses total_pay − buy_in, not platform_fixed_fee, which is 0 for online entries).
      {
        let tq = supabase.from("tournaments")
          .select(`id, club_id, rake_amount, free_rake_enabled, free_rake_used, created_at${svcOn ? ", service_fee_amount" : ""}`)
          .gte("created_at", fromTs).lte("created_at", toTs).limit(5000);
        if (restrictIds) tq = tq.in("club_id", restrictIds);
        const { data: tours, error: te } = await tq;
        if (te) throw te;
        const scopedTours = (tours ?? []).filter((t) => inScope(t.club_id));
        const tourById = new Map(scopedTours.map((t) => [t.id, t]));
        const tourIds = scopedTours.map((t) => t.id);
        // per-tour, per-source confirmed counts + actual collected (reconciliation)
        const agg = new Map<string, { nOnline: number; nOffline: number; nReentry: number; actual: number }>();
        const bump = (tid: string) => {
          let a = agg.get(tid);
          if (!a) { a = { nOnline: 0, nOffline: 0, nReentry: 0, actual: 0 }; agg.set(tid, a); }
          return a;
        };
        for (let i = 0; i < tourIds.length; i += CHUNK) {
          const chunk = tourIds.slice(i, i + CHUNK);
          if (!chunk.length) break;
          const { data: regs } = await supabase.from("tournament_registrations")
            .select("tournament_id, reference_code, total_pay, buy_in")
            .in("tournament_id", chunk).eq("status", "confirmed");
          (regs ?? []).forEach((r) => {
            const tour = tourById.get(r.tournament_id);
            if (!tour) return;
            const a = bump(r.tournament_id);
            const ref = String((r as any).reference_code ?? "");
            if (ref.startsWith("REENTRY-")) a.nReentry += 1;
            else if (ref.startsWith("CASH-")) a.nOffline += 1;
            else a.nOnline += 1;
            // rakeActual is RAKE-ONLY: subtract the per-tour service fee (folded into total_pay) when live.
            const svc = svcOn ? Number((tour as any).service_fee_amount ?? 0) : 0;
            a.actual += Math.max(0, Number(r.total_pay ?? 0) - Number(r.buy_in ?? 0) - svc);
          });
        }
        scopedTours.forEach((t) => {
          const a = agg.get(t.id) ?? { nOnline: 0, nOffline: 0, nReentry: 0, actual: 0 };
          const rakeAmt = Number(t.rake_amount ?? 0);
          const free = t.free_rake_enabled ? Number(t.free_rake_used ?? 0) : 0;
          const cfgOnline = rakeAmt * Math.max(0, a.nOnline - free);
          const cfgOffline = rakeAmt * a.nOffline;
          const cfgReentry = rakeAmt * a.nReentry;
          rakeOnline += cfgOnline; rakeOffline += cfgOffline; rakeReentry += cfgReentry;
          rakeActual += a.actual;
          // service fee = configured amount × every paying entry (free-rake never waives the service fee)
          const svcAmt = svcOn ? Number((t as any).service_fee_amount ?? 0) : 0;
          const cfgService = svcAmt * (a.nOnline + a.nOffline + a.nReentry);
          serviceFee += cfgService;
          const cfgTotal = cfgOnline + cfgOffline + cfgReentry + cfgService;
          if (cfgTotal > 0) addRev(t.club_id, cfgTotal, monthKey(t.created_at ?? toTs));
        });
      }
      rake = rakeOnline + rakeOffline + rakeReentry; // headline = CONFIGURED (rake_amount × paying entries)
      rakeExpected = rake;                           // configured IS the expectation in this model

      // ===== Cost — SAVED dealer payroll (no recompute) + status/aging =====
      const statusTotals = emptyStatusTotals();
      const aging = emptyAging();
      let payrollNet = 0, payrollGross = 0, adjustments = 0, unpaidTotal = 0, reconciledTotal = 0;
      const perPeriod: ClubFinanceSummary["perPeriod"] = [];
      {
        let pq = supabase.from("payroll_periods")
          .select("id, club_id, status, period_year, period_month, period_start, period_end, locked_at, approved_at, submitted_at")
          .lte("period_start", to).gte("period_end", from).limit(2000);
        if (restrictIds) pq = pq.in("club_id", restrictIds);
        const { data: periods, error: pe } = await pq;
        if (pe) throw pe;
        const scopedPeriods = (periods ?? []).filter((p) => inScope(p.club_id));
        const periodIds = scopedPeriods.map((p) => p.id);
        const aggByPeriod = new Map<string, { net: number; gross: number; adj: number }>();
        for (let i = 0; i < periodIds.length; i += CHUNK) {
          const chunk = periodIds.slice(i, i + CHUNK);
          if (!chunk.length) break;
          const { data: dp } = await supabase.from("dealer_payroll")
            .select("period_id, net_pay_vnd, gross_pay_vnd, total_adjustments_vnd, status")
            .in("period_id", chunk);
          (dp ?? []).forEach((r) => {
            if ((r.status ?? "") === "excluded") return;
            const cur = aggByPeriod.get(r.period_id) ?? { net: 0, gross: 0, adj: 0 };
            cur.net += Number(r.net_pay_vnd ?? 0);
            cur.gross += Number(r.gross_pay_vnd ?? 0);
            cur.adj += Number(r.total_adjustments_vnd ?? 0);
            aggByPeriod.set(r.period_id, cur);
          });
        }
        scopedPeriods.forEach((p) => {
          const agg = aggByPeriod.get(p.id) ?? { net: 0, gross: 0, adj: 0 };
          payrollNet += agg.net; payrollGross += agg.gross; adjustments += agg.adj;
          cost.set(p.club_id, (cost.get(p.club_id) ?? 0) + agg.net);
          const mk = `${p.period_year}-${String(p.period_month).padStart(2, "0")}`;
          costMonth.set(mk, (costMonth.get(mk) ?? 0) + agg.net);
          const sk = normalizeStatus(p.status);
          statusTotals[sk] += agg.net;
          if (sk === "reconciled") reconciledTotal += agg.net;
          if (isUnpaid(p.status)) {
            unpaidTotal += agg.net;
            const anchor = p.locked_at ?? p.approved_at ?? p.submitted_at ?? `${p.period_end}T00:00:00`;
            aging[agingBucket(daysBetween(anchor, nowMs))] += agg.net;
          }
          perPeriod.push({
            id: p.id, clubId: p.club_id, clubName: clubName.get(p.club_id) ?? "—",
            periodKey: `${String(p.period_month).padStart(2, "0")}/${p.period_year}`,
            gross: agg.gross, net: agg.net, status: sk,
          });
        });
      }

      // ===== assemble =====
      const revenueTotal = stakingFees + payoutFees + rake + serviceFee; // configured rake + service fee (matches addRev feed)
      const months = Array.from(new Set([...revMonth.keys(), ...costMonth.keys()])).sort();
      const trend = months.map((mk) => ({
        key: `${mk.slice(5, 7)}/${mk.slice(2, 4)}`,
        revenue: revMonth.get(mk) ?? 0,
        cost: costMonth.get(mk) ?? 0,
      }));
      const allClubIds = new Set<string>([...rev.keys(), ...cost.keys()]);
      const perClub = Array.from(allClubIds).map((cid) => {
        const r = rev.get(cid) ?? 0, c = cost.get(cid) ?? 0;
        return { clubId: cid, name: clubName.get(cid) ?? "Không xác định", revenue: r, cost: c, net: r - c };
      }).sort((a, b) => b.net - a.net);
      perPeriod.sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1));

      setSummary({
        revenue: {
          stakingFees, stakingFixed, stakingPercent, stakingArchive, payoutFees,
          rake, rakeActual, rakeExpected, rakeVariance: rakeActual - rake,
          rakeOnline, rakeOffline, rakeReentry, serviceFee, total: revenueTotal, fnb: 0,
        },
        cost: { payrollNet, payrollGross, adjustments, fnbCogs: 0, compCogs: 0 },
        net: revenueTotal - payrollNet,
        statusTotals, unpaidTotal, reconciledTotal, aging, trend, perPeriod, perClub,
      });
    } catch (err) {
      console.error("[ClubFinance] load failed", err);
      setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu tài chính");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, clubFilter, isAdmin]);

  useEffect(() => { load(); }, [load]);

  return { loading, error, clubs, summary, reload: load };
}
