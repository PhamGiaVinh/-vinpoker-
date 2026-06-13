import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { formatVND } from "@/lib/format";
import { exportToExcel } from "@/lib/exportExcel";
import { useClubFinanceSummary } from "@/hooks/useClubFinanceSummary";
import {
  PAYROLL_STATUS_META, AGING_BUCKETS, margin, formatPct, formatVndShort,
  type PayrollStatusKey,
} from "@/lib/clubFinance";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Coins, Users, TrendingUp, Clock, ShieldCheck, Download, RefreshCw,
  Building2, PieChart as PieChartIcon, AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const REV_COLORS = { staking: "#00ff88", payout: "#1D9E75", rake: "#97C459" };

const tooltipStyle = {
  background: "#16191c",
  border: "1px solid #2a2f36",
  borderRadius: 8,
  fontSize: 12,
  color: "#e6e8eb",
} as const;

const ClubFinanceDashboard = () => {
  const { isAdmin, isClubAdmin } = useAuth();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [clubFilter, setClubFilter] = useState("all");

  const { loading, error, clubs, summary, reload } = useClubFinanceSummary({ from, to, clubFilter });

  const donut = useMemo(() => {
    if (!summary) return [];
    return (Object.keys(summary.statusTotals) as PayrollStatusKey[])
      .map((k) => ({ key: k, label: PAYROLL_STATUS_META[k].label, value: summary.statusTotals[k], tone: PAYROLL_STATUS_META[k].tone }))
      .filter((d) => d.value > 0);
  }, [summary]);

  const agingData = useMemo(
    () => (summary ? AGING_BUCKETS.map((b) => ({ label: b.label, value: summary.aging[b.key], tone: b.tone })) : []),
    [summary],
  );
  const costClubs = useMemo(
    () => (summary ? summary.perClub.filter((c) => c.cost > 0 || c.revenue > 0).slice(0, 8) : []),
    [summary],
  );

  // Visible to club_admin + super_admin only (role-gated). Placed AFTER all hooks (rules-of-hooks).
  if (!isClubAdmin) {
    return <Navigate to="/" replace />;
  }

  const exportXlsx = () => {
    if (!summary) return;
    exportToExcel(
      summary.perClub.map((c, i) => ({ ...c, _stt: i + 1 })),
      [
        { header: "STT", get: (r) => r._stt },
        { header: "CÂU LẠC BỘ", get: (r) => r.name },
        { header: "DOANH THU (₫)", get: (r) => r.revenue },
        { header: "CHI PHÍ LƯƠNG (₫)", get: (r) => r.cost },
        { header: "LÃI RÒNG (₫)", get: (r) => r.net },
      ],
      `tai-chinh-clb_${from}_${to}`,
      "TỔNG HỢP THEO CLB",
    );
    exportToExcel(
      summary.perPeriod.map((p, i) => ({ ...p, _stt: i + 1 })),
      [
        { header: "STT", get: (r) => r._stt },
        { header: "CLB", get: (r) => r.clubName },
        { header: "KỲ", get: (r) => r.periodKey },
        { header: "TỔNG LƯƠNG (₫)", get: (r) => r.gross },
        { header: "THỰC TRẢ (₫)", get: (r) => r.net },
        { header: "TRẠNG THÁI", get: (r) => PAYROLL_STATUS_META[r.status].label },
      ],
      `tai-chinh-clb-ky-luong_${from}_${to}`,
      "THEO KỲ LƯƠNG",
    );
  };

  const r = summary?.revenue;
  const seg = (v: number) => (r && r.total > 0 ? (v / r.total) * 100 : 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl text-primary">Tài chính CLB</h1>
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
            {isAdmin ? "super_admin · toàn bộ CLB" : "chủ CLB"}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">Đọc giá trị đã lưu · không tính lại lương</div>
      </div>

      {/* Filters */}
      <Card className="p-3 gradient-card border-primary/20">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Từ ngày</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Đến ngày</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setFrom(daysAgoISO(7)); setTo(todayISO()); }}>7 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setFrom(daysAgoISO(30)); setTo(todayISO()); }}>30 ngày</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => { setFrom(monthStartISO()); setTo(todayISO()); }}>Tháng này</Button>
          </div>
          {isAdmin && (
            <div>
              <Label className="text-xs text-muted-foreground">Câu lạc bộ</Label>
              <Select value={clubFilter} onValueChange={setClubFilter}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả các CLB</SelectItem>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-1 ml-auto">
            <Button size="sm" variant="outline" className="h-9" onClick={reload} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={exportXlsx} disabled={!summary}>
              <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" /> {error}
        </Card>
      )}

      {loading || !summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi icon={<Coins className="w-3.5 h-3.5" />} label="Doanh thu thật" value={formatVND(summary.revenue.total)} hint="phí + rake" accent="text-primary" />
            <Kpi icon={<Users className="w-3.5 h-3.5" />} label="Chi phí lương" value={formatVND(summary.cost.payrollNet)} hint="đã lưu" accent="text-[#f0997b]" />
            <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="Lãi ròng" value={formatVND(summary.net)} hint={`biên ${formatPct(margin(summary.net, summary.revenue.total))}`} accent="text-primary" highlight />
            <Kpi icon={<Clock className="w-3.5 h-3.5" />} label="Lương chưa trả" value={formatVND(summary.unpaidTotal)} hint="chờ chi trả" accent="text-amber-400" />
            <Kpi icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Đã đối soát" value={formatVND(summary.reconciledTotal)} hint="hoàn tất" accent="text-[#378ADD]" />
          </div>

          {/* Net formula note */}
          <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <span className="text-foreground/80">Net = Phí staking + Phí chi trả staking + Rake giải − Lương đã lưu</span>
            <span>·</span>
            <span>buy-in, vốn staking, tiền mặt cashier &amp; F&amp;B KHÔNG tính vào Net</span>
          </div>

          {/* Revenue breakdown */}
          <Card className="p-4 gradient-card border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><PieChartIcon className="w-4 h-4 text-primary" /> Cơ cấu doanh thu thật</div>
              <div className="text-sm font-bold text-primary">{formatVND(summary.revenue.total)}</div>
            </div>
            <div className="flex h-3.5 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${seg(summary.revenue.stakingFees)}%`, background: REV_COLORS.staking }} />
              <div style={{ width: `${seg(summary.revenue.payoutFees)}%`, background: REV_COLORS.payout }} />
              <div style={{ width: `${seg(summary.revenue.rake)}%`, background: REV_COLORS.rake }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
              <LegendDot color={REV_COLORS.staking} label="Phí staking" value={formatVND(summary.revenue.stakingFees)} />
              <LegendDot color={REV_COLORS.payout} label="Phí chi trả staking" value={formatVND(summary.revenue.payoutFees)} />
              <LegendDot color={REV_COLORS.rake} label="Rake giải" value={formatVND(summary.revenue.rake)} />
              <span className="flex items-center gap-1 text-muted-foreground/70">
                <span className="inline-block w-2 h-2 rounded-[2px] border border-dashed border-muted-foreground/60" />
                Đồ ăn / F&amp;B — module riêng, chưa tích hợp
              </span>
            </div>
          </Card>

          {/* Charts: trend + donut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Doanh thu vs Chi phí lương</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f36" vertical={false} />
                    <XAxis dataKey="key" tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={{ stroke: "#2a2f36" }} />
                    <YAxis tickFormatter={(v) => formatVndShort(Number(v))} tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} />
                    <Area type="monotone" dataKey="revenue" name="Doanh thu" stroke="#00ff88" fill="rgba(0,255,136,0.14)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cost" name="Lương" stroke="#f0997b" fill="rgba(240,153,123,0.10)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Trạng thái payroll</div>
              {donut.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">Chưa có kỳ lương trong khoảng này.</div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-[200px] flex-1 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donut} dataKey="value" nameKey="label" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                          {donut.map((d) => <Cell key={d.key} fill={d.tone} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    {donut.map((d) => <LegendDot key={d.key} color={d.tone} label={d.label} />)}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Charts: aging + cost-by-club (admin) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 gradient-card border-primary/20">
              <div className="text-sm font-semibold mb-2">Tuổi nợ lương chưa trả</div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2f36" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={{ stroke: "#2a2f36" }} />
                    <YAxis tickFormatter={(v) => formatVndShort(Number(v))} tick={{ fontSize: 11, fill: "#8b9099" }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatVND(Number(v))} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {agingData.map((a, i) => <Cell key={i} fill={a.tone} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {isAdmin && (
              <Card className="p-4 gradient-card border-primary/20">
                <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Chi phí lương theo CLB</div>
                <div className="space-y-2.5">
                  {costClubs.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-6 text-center">Chưa có dữ liệu.</div>
                  ) : costClubs.map((c) => {
                    const max = Math.max(...costClubs.map((x) => x.cost), 1);
                    return (
                      <div key={c.clubId}>
                        <div className="flex justify-between text-[11px] mb-1"><span className="truncate">{c.name}</span><span>{formatVND(c.cost)}</span></div>
                        <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-2 rounded" style={{ width: `${(c.cost / max) * 100}%`, background: "#f0997b" }} /></div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>

          {/* Per-club table (admin) */}
          {isAdmin && summary.perClub.length > 0 && (
            <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">So sánh theo câu lạc bộ</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Câu lạc bộ</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                      <TableHead className="text-right">Lương</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.perClub.map((c) => (
                      <TableRow key={c.clubId} className={isAdmin ? "cursor-pointer" : ""} onClick={() => isAdmin && setClubFilter(c.clubId)}>
                        <TableCell className="text-sm font-medium">{c.name}</TableCell>
                        <TableCell className="text-right text-xs text-primary">{formatVND(c.revenue)}</TableCell>
                        <TableCell className="text-right text-xs text-[#f0997b]">{formatVND(c.cost)}</TableCell>
                        <TableCell className="text-right text-xs font-bold">{formatVND(c.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-bold">TỔNG</TableCell>
                      <TableCell className="text-right text-primary">{formatVND(summary.revenue.total)}</TableCell>
                      <TableCell className="text-right text-[#f0997b]">{formatVND(summary.cost.payrollNet)}</TableCell>
                      <TableCell className="text-right font-bold">{formatVND(summary.net)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </Card>
          )}

          {/* Per-period table */}
          <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">Theo kỳ lương</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && <TableHead>CLB</TableHead>}
                    <TableHead>Kỳ</TableHead>
                    <TableHead className="text-right">Tổng lương</TableHead>
                    <TableHead className="text-right">Thực trả</TableHead>
                    <TableHead className="text-right">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.perPeriod.length === 0 ? (
                    <TableRow><TableCell colSpan={isAdmin ? 5 : 4} className="text-center text-muted-foreground py-8">Không có kỳ lương trong khoảng này.</TableCell></TableRow>
                  ) : summary.perPeriod.map((p) => (
                    <TableRow key={p.id}>
                      {isAdmin && <TableCell className="text-xs">{p.clubName}</TableCell>}
                      <TableCell className="text-sm font-medium">{p.periodKey}</TableCell>
                      <TableCell className="text-right text-xs">{formatVND(p.gross)}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{formatVND(p.net)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="text-[9px]" style={{ background: `${PAYROLL_STATUS_META[p.status].tone}22`, color: PAYROLL_STATUS_META[p.status].tone }}>
                          {PAYROLL_STATUS_META[p.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

function Kpi({ icon, label, value, hint, accent, highlight }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; accent?: string; highlight?: boolean;
}) {
  return (
    <Card className={`p-3 gradient-card ${highlight ? "border-primary/40" : "border-primary/20"}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className={`text-lg font-display font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </Card>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: color }} />
      {label}{value ? ` · ${value}` : ""}
    </span>
  );
}

export default ClubFinanceDashboard;
