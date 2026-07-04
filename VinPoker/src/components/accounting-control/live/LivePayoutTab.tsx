import { useClubPayoutLiability } from "@/hooks/useClubPayoutLiability";
import { PayoutLiabilityTab, type LivePayoutData } from "../tabs/PayoutLiabilityTab";

const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * W3-B1 live wrapper — mounted ONLY when `accountingControlLivePayout` is ON. Read-only; maps
 * get_club_payout_liability into the tab's `live` prop. On 42883/42P01 (RPC not applied yet) the
 * hook reports notApplied → the tab degrades to "chưa áp dụng" + mock.
 */
export function LivePayoutTab() {
  const from = monthStartISO();
  const to = todayISO();
  const { loading, error, notApplied, data } = useClubPayoutLiability({ from, to, clubFilter: "all" });

  const mapped: LivePayoutData | null = data
    ? {
        periodLabel: `Tháng này · ${dm(from)} → ${dm(to)}`,
        owedTotal: data.owedTotal,
        paidTotal: data.paidTotal,
        outstandingTotal: data.outstandingTotal,
        perTournament: data.perTournament,
        aging: data.aging,
      }
    : null;

  return <PayoutLiabilityTab live={{ active: true, loading, error, notApplied, data: mapped }} />;
}
