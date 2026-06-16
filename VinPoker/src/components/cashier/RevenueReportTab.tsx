import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatVND, formatDateTime } from "@/lib/format";
import { exportToExcel, formatExcelDate } from "@/lib/exportExcel";
import { Loader2, Download, Wallet, TrendingUp, TrendingDown, PiggyBank, FileSpreadsheet, Trophy, Coins } from "lucide-react";
import { toast } from "sonner";

interface Props {
  clubIds: string[];
  clubs: { id: string; name: string }[];
}

export default function RevenueReportTab({ clubIds, clubs }: Props) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [clubFilter, setClubFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rawDeals, setRawDeals] = useState<any[] | null>(null);
  // Tournament rake + service fee actually collected (confirmed registrations in range).
  const [tourFees, setTourFees] = useState<{ rakeCollected: number; serviceCollected: number; entries: number } | null>(null);
  const [detailTab, setDetailTab] = useState("earlybird");

  const load = useCallback(async () => {
    setLoading(true);
    setRawDeals(null);
    setTourFees(null);

    const ids = clubFilter ? [clubFilter] : clubIds;

    let q = supabase
      .from("staking_deals")
      .select(`id, custom_event_name, status, created_at, updated_at, buy_in_amount_vnd,
        result_prize_vnd, filled_percent, percentage_sold, markup,
        platform_fixed_fee, platform_percent_fee, platform_archive_fee, platform_fee_vnd,
        backer_payout_vnd, player_payout_vnd, club_id, player_id,
        result_entered_at, release_requested_at, payout_executed_at,
        player_checked_in, early_closed, player_busted_out`)
      .gte("created_at", from + "T00:00:00")
      .lte("created_at", to + "T23:59:59")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (ids.length) q = q.in("club_id", ids);

    const { data, error } = await q;
    if (error) { toast.error(error.message); setRawDeals([]); setLoading(false); return; }
    setRawDeals(data ?? []);

    // Tournament rake + service fee actually collected: confirmed registrations in range, decomposed
    // into rake vs service using the tour's configured service_fee_amount (matches Owner Finance).
    try {
      let tq = supabase.from("tournaments").select("id, rake_amount, service_fee_amount");
      if (ids.length) tq = tq.in("club_id", ids);
      const { data: tours } = await tq;
      const tourMap = new Map((tours ?? []).map((t: any) => [t.id, t]));
      const tourIds = (tours ?? []).map((t: any) => t.id);
      let rakeCollected = 0, serviceCollected = 0, entries = 0;
      for (let i = 0; i < tourIds.length; i += 200) {
        const chunk = tourIds.slice(i, i + 200);
        if (!chunk.length) break;
        const { data: regs } = await supabase
          .from("tournament_registrations")
          .select("tournament_id, total_pay, buy_in")
          .in("tournament_id", chunk)
          .eq("status", "confirmed")
          .gte("created_at", from + "T00:00:00")
          .lte("created_at", to + "T23:59:59");
        (regs ?? []).forEach((r: any) => {
          const t: any = tourMap.get(r.tournament_id);
          if (!t) return;
          const svc = Number(t.service_fee_amount ?? 0);
          const fee = Math.max(0, Number(r.total_pay ?? 0) - Number(r.buy_in ?? 0));
          const servicePart = Math.min(svc, fee);
          rakeCollected += fee - servicePart;
          serviceCollected += servicePart;
          entries += 1;
        });
      }
      setTourFees({ rakeCollected, serviceCollected, entries });
    } catch {
      setTourFees({ rakeCollected: 0, serviceCollected: 0, entries: 0 });
    }

    setLoading(false);
  }, [from, to, clubFilter, clubIds]);

  useEffect(() => { load(); }, [load]);

  const kpi = useMemo(() => {
    if (!rawDeals) return null;
    const completed = rawDeals.filter((d) =>
      ["completed", "released", "result_verified", "result_entered", "release_requested"].includes(d.status)
    );
    const totalRevenue = rawDeals.reduce((s, d) => s + (Number(d.platform_fee_vnd) || 0), 0);
    const earlyBirdGross = rawDeals.filter((d) => d.status === "funded" || d.status === "result_entered")
      .reduce((s, d) => s + (Number(d.buy_in_amount_vnd) || 0) * (Number(d.filled_percent) || 0) / 100, 0);
    const totalEntryFees = rawDeals.reduce((s, d) => s + (Number(d.buy_in_amount_vnd) || 0), 0);
    const totalArchive = rawDeals.reduce((s, d) => s + (Number(d.platform_archive_fee) || 0), 0);
    const totalPrizePool = completed.reduce((s, d) => s + (Number(d.result_prize_vnd) || 0), 0);
    const netProfit = totalRevenue - totalArchive;
    const dealCount = rawDeals.length;
    const completedCount = completed.length;
    const bustedCount = rawDeals.filter((d) => d.player_busted_out).length;
    return { totalRevenue, earlyBirdGross, totalEntryFees, totalArchive, totalPrizePool, netProfit, dealCount, completedCount, bustedCount };
  }, [rawDeals]);

  const exportCsv = () => {
    if (!rawDeals) return;
    const data = rawDeals.map((d) => ({
      ...d,
      created: formatExcelDate(d.created_at),
      updated: formatExcelDate(d.updated_at),
    }));
    exportToExcel(data, [
      { header: "ID", get: (r: any) => r.id.slice(0, 8) },
      { header: "Sự kiện", get: (r: any) => r.custom_event_name ?? "" },
      { header: "Trạng thái", get: (r: any) => r.status },
      { header: "Ngày tạo", get: (r: any) => r.created },
      { header: "Buy-in", get: (r: any) => r.buy_in_amount_vnd ?? 0 },
      { header: "Prize", get: (r: any) => r.result_prize_vnd ?? 0 },
      { header: "% bán", get: (r: any) => r.filled_percent },
      { header: "Phí nền tảng", get: (r: any) => r.platform_fee_vnd ?? 0 },
      { header: "Backer payout", get: (r: any) => r.backer_payout_vnd ?? 0 },
      { header: "Player payout", get: (r: any) => r.player_payout_vnd ?? 0 },
      { header: "Busted", get: (r: any) => r.player_busted_out ? "Yes" : "No" },
    ], `revenue-${from}-${to}`, "Revenue");
  };

  const earlyBirdDeals = useMemo(() => {
    if (!rawDeals) return [];
    return rawDeals.filter((d) => d.status === "funded" || d.status === "result_entered");
  }, [rawDeals]);

  const stakingDetailDeals = useMemo(() => {
    if (!rawDeals) return [];
    return rawDeals.filter((d) =>
      ["completed", "released", "result_verified", "result_entered", "release_requested"].includes(d.status)
    );
  }, [rawDeals]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Từ ngày</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Đến ngày</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Câu lạc bộ</label>
            <select className="w-full h-10 rounded-md border bg-background px-2 text-sm"
              value={clubFilter} onChange={(e) => setClubFilter(e.target.value)}>
              <option value="">— Tất cả CLB phụ trách —</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button onClick={load} disabled={loading} variant="outline" size="sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Làm mới
          </Button>
          <Button onClick={exportCsv} disabled={!rawDeals?.length} size="sm">
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </Card>

      {/* KPI Cards */}
      {kpi ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <Card className="p-4 border-primary/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="w-4 h-4 text-primary" /> Phí staking đã thu
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(kpi.totalRevenue)}</div>
          </Card>
          <Card className="p-4 border-primary/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Trophy className="w-4 h-4 text-primary" /> Rake giải đã thu
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(tourFees?.rakeCollected ?? 0)}</div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">{tourFees?.entries ?? 0} lượt đăng ký</div>
          </Card>
          <Card className="p-4 border-warning/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Coins className="w-4 h-4 text-warning" /> Phí dịch vụ đã thu
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(tourFees?.serviceCollected ?? 0)}</div>
          </Card>
          <Card className="p-4 border-[hsl(var(--ds-active)_/_0.3)]">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="w-4 h-4 text-[hsl(var(--ds-active))]" /> Early Bird (gross)
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(kpi.earlyBirdGross)}</div>
          </Card>
          <Card className="p-4 border-warning/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <PiggyBank className="w-4 h-4 text-warning" /> Tổng Entry Fees
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(kpi.totalEntryFees)}</div>
          </Card>
          <Card className="p-4 border-[hsl(var(--ds-preassign)_/_0.3)]">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4 text-[hsl(var(--ds-preassign))]" /> Phí lưu trữ
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(kpi.totalArchive)}</div>
          </Card>
          <Card className="p-4 border-success/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingDown className="w-4 h-4 text-success" /> Lợi nhuận ròng
            </div>
            <div className="mt-1 text-lg font-bold font-mono">{formatVND(kpi.netProfit)}</div>
          </Card>
          <Card className="p-4 border-muted-foreground/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Deals / Hoàn tất / Busted
            </div>
            <div className="mt-1 text-lg font-bold font-mono">
              {kpi.dealCount} / {kpi.completedCount} / {kpi.bustedCount}
            </div>
          </Card>
        </div>
      ) : (
        <Skeleton className="h-28 rounded-xl" />
      )}

      {/* Detail Tables */}
      {rawDeals && (
        <Card className="p-3">
          <Tabs value={detailTab} onValueChange={setDetailTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-auto">
              <TabsTrigger value="earlybird">Early Bird Deals</TabsTrigger>
              <TabsTrigger value="staking">Staking Detail</TabsTrigger>
            </TabsList>

            <TabsContent value="earlybird" className="mt-4">
              {earlyBirdDeals.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">Không có early bird deals</div>
              ) : (
                <div className="overflow-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Sự kiện</TableHead>
                        <TableHead>Buy-in</TableHead>
                        <TableHead>% bán</TableHead>
                        <TableHead>Markup</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Ngày tạo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {earlyBirdDeals.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}</TableCell>
                          <TableCell className="font-medium">{d.custom_event_name ?? "—"}</TableCell>
                          <TableCell className="font-mono">{formatVND(d.buy_in_amount_vnd)}</TableCell>
                          <TableCell>{d.filled_percent}%</TableCell>
                          <TableCell>{d.markup}x</TableCell>
                          <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                          <TableCell className="text-xs">{formatDateTime(d.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="staking" className="mt-4">
              {stakingDetailDeals.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">Không có dữ liệu</div>
              ) : (
                <div className="overflow-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Sự kiện</TableHead>
                        <TableHead>Prize</TableHead>
                        <TableHead>Phí nền tảng</TableHead>
                        <TableHead>Backer nhận</TableHead>
                        <TableHead>Player nhận</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Busted</TableHead>
                        <TableHead>Ngày hoàn tất</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stakingDetailDeals.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}</TableCell>
                          <TableCell className="font-medium">{d.custom_event_name ?? "—"}</TableCell>
                          <TableCell className="font-mono">{formatVND(d.result_prize_vnd ?? 0)}</TableCell>
                          <TableCell className="font-mono">{formatVND(d.platform_fee_vnd ?? 0)}</TableCell>
                          <TableCell className="font-mono">{formatVND(d.backer_payout_vnd ?? 0)}</TableCell>
                          <TableCell className="font-mono">{formatVND(d.player_payout_vnd ?? 0)}</TableCell>
                          <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                          <TableCell>{d.player_busted_out ? "✅" : "—"}</TableCell>
                          <TableCell className="text-xs">{formatDateTime(d.payout_executed_at ?? d.updated_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      )}

      {rawDeals && rawDeals.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground">
          Không có dữ liệu trong khoảng đã chọn
        </Card>
      )}
    </div>
  );
}
