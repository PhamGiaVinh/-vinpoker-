import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coins, Download, RefreshCw, TrendingUp, Archive, Wallet, Building2, Filter, X } from "lucide-react";
import { formatVND, formatDateTime } from "@/lib/format";
import { exportToExcel, formatExcelDate } from "@/lib/exportExcel";

type FeeDeal = {
  id: string;
  player_id: string;
  club_id: string | null;
  custom_event_name: string | null;
  buy_in_amount_vnd: number;
  status: string;
  platform_fixed_fee: number | null;
  platform_archive_fee: number | null;
  result_prize_vnd: number | null;
  player_checked_in: boolean | null;
  player_checkin_at: string | null;
  committed_at: string | null;
  completed_at: string | null;
  created_at: string;
  player?: { display_name: string | null; phone: string | null } | null;
  club?: { name: string | null } | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const maskPhone = (p?: string | null) => {
  if (!p) return "—";
  const digits = p.replace(/\D/g, "");
  if (digits.length < 6) return p;
  return digits.slice(0, 3) + "****" + digits.slice(-3);
};

const ARCHIVE_DEFAULT = 199000;

const FeeRevenueDashboard = () => {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<FeeDeal[]>([]);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [clubFilter, setClubFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const fromTs = new Date(from + "T00:00:00").toISOString();
    const toTs = new Date(to + "T23:59:59").toISOString();

    // For non-admin (cashier / club owner): scope to clubs they own
    let ownedClubIds: string[] | null = null;
    if (!isAdmin) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ownClubs } = await supabase.from("clubs").select("id").eq("owner_id", user.id);
        ownedClubIds = (ownClubs ?? []).map((c: any) => c.id);
        if (ownedClubIds.length === 0) {
          setDeals([]); setAllClubs([]); setLoading(false); return;
        }
      }
    }

    let q = supabase
      .from("staking_deals")
      .select(`
        id, player_id, club_id, custom_event_name, buy_in_amount_vnd, status,
        platform_fixed_fee, platform_archive_fee, result_prize_vnd,
        player_checked_in, player_checkin_at,
        committed_at, completed_at, created_at
      `)
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (ownedClubIds) q = q.in("club_id", ownedClubIds);

    const { data, error } = await q;

    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const playerIds = Array.from(new Set((data ?? []).map((d) => d.player_id)));
    const clubIds = Array.from(new Set((data ?? []).map((d) => d.club_id).filter(Boolean) as string[]));

    const [{ data: profs }, { data: clubs }] = await Promise.all([
      playerIds.length
        ? supabase.from("profiles").select("user_id, display_name, phone").in("user_id", playerIds)
        : Promise.resolve({ data: [] as any[] }),
      clubIds.length
        ? supabase.from("clubs").select("id, name").in("id", clubIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
    const clubMap = new Map((clubs ?? []).map((c: any) => [c.id, c.name as string]));

    setAllClubs(Array.from(clubMap.entries()).map(([id, name]) => ({ id, name })));
    setDeals(
      (data ?? []).map((d: any) => ({
        ...d,
        player: profMap.get(d.player_id)
          ? { display_name: profMap.get(d.player_id).display_name, phone: profMap.get(d.player_id).phone }
          : null,
        club: { name: d.club_id ? clubMap.get(d.club_id) ?? null : null },
      })),
    );
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  // Per-row computed
  type Row = ReturnType<typeof computeRow>;
  function computeRow(d: FeeDeal) {
    const entryFee = Number(d.platform_fixed_fee ?? 0);
    const archiveFee = Number(d.platform_archive_fee ?? ARCHIVE_DEFAULT);
    const checkedIn = !!d.player_checked_in;
    const entryCollected = checkedIn && entryFee > 0;
    const prize = Number(d.result_prize_vnd ?? 0);
    const archiveEligible = d.status === "completed" && prize > 0;
    const archiveCollected = archiveEligible ? Math.min(archiveFee, prize) : 0;
    const totalCollected = (entryCollected ? entryFee : 0) + archiveCollected;
    return { deal: d, entryFee, entryCollected, checkedIn, archiveFee, archiveEligible, archiveCollected, totalCollected, prize };
  }

  const filtered = useMemo(
    () => (clubFilter === "all" ? deals : deals.filter((d) => d.club_id === clubFilter)),
    [deals, clubFilter],
  );

  const rows: Row[] = useMemo(() => filtered.map(computeRow), [filtered]);

  // Per-club summary (built from full date range, ignores clubFilter so the table stays useful)
  const clubSummary = useMemo(() => {
    const map = new Map<string, {
      club_id: string; club_name: string;
      checked_in_count: number; total_entry_fee: number;
      completed_with_prize_count: number; total_archive_fee: number;
      total_revenue: number;
    }>();
    deals.forEach((d) => {
      const id = d.club_id ?? "__none__";
      const name = d.club?.name ?? "Không xác định";
      if (!map.has(id)) {
        map.set(id, { club_id: id, club_name: name, checked_in_count: 0, total_entry_fee: 0, completed_with_prize_count: 0, total_archive_fee: 0, total_revenue: 0 });
      }
      const r = computeRow(d);
      const s = map.get(id)!;
      if (r.entryCollected) { s.total_entry_fee += r.entryFee; s.checked_in_count += 1; }
      if (r.archiveEligible) { s.total_archive_fee += r.archiveCollected; s.completed_with_prize_count += 1; }
      s.total_revenue = s.total_entry_fee + s.total_archive_fee;
    });
    return Array.from(map.values()).sort((a, b) => b.total_revenue - a.total_revenue);
  }, [deals]);

  const totals = useMemo(() => {
    let entry = 0, archive = 0, ci = 0, comp = 0;
    rows.forEach((r) => {
      if (r.entryCollected) { entry += r.entryFee; ci += 1; }
      if (r.archiveEligible) { archive += r.archiveCollected; comp += 1; }
    });
    return { entry, archive, total: entry + archive, deals: rows.length, checked_in: ci, completed: comp };
  }, [rows]);

  const exportXlsx = async () => {
    const summaryRows = (clubFilter === "all" ? clubSummary : clubSummary.filter((c) => c.club_id === clubFilter))
      .map((c, i) => ({ ...c, _stt: i + 1 }));
    exportToExcel(
      summaryRows,
      [
        { header: "STT", get: (r) => r._stt },
        { header: "TÊN CÂU LẠC BỘ", get: (r) => r.club_name },
        { header: "TỔNG PHIẾU CHECK-IN", get: (r) => r.checked_in_count },
        { header: "TỔNG PHÍ ĐẦU VÀO (₫)", get: (r) => r.total_entry_fee },
        { header: "TỔNG PHIẾU HOÀN TẤT CÓ THƯỞNG", get: (r) => r.completed_with_prize_count },
        { header: "TỔNG PHÍ LƯU TRỮ (₫)", get: (r) => r.total_archive_fee },
        { header: "TỔNG DOANH THU (₫)", get: (r) => r.total_revenue },
      ],
      `bao-cao-phi-tong-quan_${from}_${to}`,
      "TỔNG QUAN THEO CLB",
    );
    const detailRows = rows.map((r, i) => ({ ...r, _stt: i + 1 }));
    exportToExcel(
      detailRows,
      [
        { header: "STT", get: (r) => r._stt },
        { header: "MÃ PHIẾU", get: (r) => r.deal.id.slice(0, 6).toUpperCase() },
        { header: "NGÀY CHECK-IN", get: (r) => formatExcelDate(r.deal.player_checkin_at) },
        { header: "NGƯỜI TẬP HUẤN", get: (r) => r.deal.player?.display_name ?? "—" },
        { header: "SỐ ĐIỆN THOẠI", get: (r) => maskPhone(r.deal.player?.phone) },
        { header: "CÂU LẠC BỘ", get: (r) => r.deal.club?.name ?? "—" },
        { header: "TÊN GIẢI TẬP HUẤN", get: (r) => r.deal.custom_event_name ?? "—" },
        { header: "LỆ PHÍ TẬP HUẤN (₫)", get: (r) => r.deal.buy_in_amount_vnd },
        { header: "PHÍ NỀN TẢNG ĐẦU VÀO (₫)", get: (r) => (r.entryCollected ? r.entryFee : 0) },
        { header: "TRẠNG THÁI ĐẦU VÀO", get: (r) => (r.entryCollected ? "Đã thu" : r.checkedIn ? "Không phát sinh" : "Chưa check-in") },
        { header: "THÀNH TÍCH (₫)", get: (r) => r.prize },
        { header: "PHÍ LƯU TRỮ HỒ SƠ (₫)", get: (r) => r.archiveCollected },
        { header: "TRẠNG THÁI LƯU TRỮ", get: (r) => (r.archiveEligible ? "Đã thu" : r.deal.status === "completed" ? "Không phát sinh" : "Chưa đủ điều kiện") },
        { header: "TỔNG PHÍ VBacker (₫)", get: (r) => r.totalCollected },
      ],
      `bao-cao-phi-chi-tiet_${from}_${to}`,
      "CHI TIẾT PHIẾU",
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* LEFT: Filter Panel */}
      <Card className="p-4 gradient-card border-primary/20 h-fit lg:sticky lg:top-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <Filter className="w-4 h-4 text-primary" /> Bộ lọc
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Từ ngày</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Đến ngày</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          {isAdmin && (
            <div>
              <Label className="text-xs text-muted-foreground">Câu lạc bộ</Label>
              <Select value={clubFilter} onValueChange={setClubFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả các CLB</SelectItem>
                  {allClubs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading} className="w-full">
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
            <Button size="sm" variant="outline" onClick={exportXlsx} disabled={!rows.length} className="w-full">
              <Download className="w-3.5 h-3.5 mr-1" /> Xuất Excel
            </Button>
            {clubFilter !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setClubFilter("all")} className="w-full">
                <X className="w-3.5 h-3.5 mr-1" /> Xóa bộ lọc CLB
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* RIGHT: Data */}
      <div className="space-y-4 min-w-0">
        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-4 gradient-card border-primary/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="w-3.5 h-3.5" /> Tổng phí đầu vào</div>
            <div className="text-2xl font-display font-bold text-primary mt-1">{formatVND(totals.entry)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{totals.checked_in} phiếu đã check-in</div>
          </Card>
          <Card className="p-4 gradient-card border-primary/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Archive className="w-3.5 h-3.5" /> Tổng phí lưu trữ</div>
            <div className="text-2xl font-display font-bold text-primary mt-1">{formatVND(totals.archive)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{totals.completed} phiếu hoàn tất có thưởng</div>
          </Card>
          <Card className="p-4 gradient-gold border-gold/40">
            <div className="flex items-center gap-2 text-xs text-primary-foreground/80"><Wallet className="w-3.5 h-3.5" /> Tổng doanh thu</div>
            <div className="text-2xl font-display font-bold text-primary-foreground mt-1">{formatVND(totals.total)}</div>
            <div className="text-[11px] text-primary-foreground/80 mt-1">{totals.deals} phiếu trong khoảng</div>
          </Card>
        </div>

        {/* Per-Club Summary (only when admin + all) */}
        {isAdmin && clubFilter === "all" && clubSummary.length > 1 && (
          <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 text-sm font-semibold">
              <Building2 className="w-4 h-4 text-primary" /> Tổng hợp theo câu lạc bộ
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Câu lạc bộ</TableHead>
                    <TableHead className="text-right">Check-in</TableHead>
                    <TableHead className="text-right">Phí đầu vào</TableHead>
                    <TableHead className="text-right">HT có thưởng</TableHead>
                    <TableHead className="text-right">Phí lưu trữ</TableHead>
                    <TableHead className="text-right">Tổng</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clubSummary.map((c) => (
                    <TableRow key={c.club_id} className="cursor-pointer" onClick={() => c.club_id !== "__none__" && setClubFilter(c.club_id)}>
                      <TableCell className="text-sm font-medium">{c.club_name}</TableCell>
                      <TableCell className="text-right text-xs">{c.checked_in_count}</TableCell>
                      <TableCell className="text-right text-xs">{formatVND(c.total_entry_fee)}</TableCell>
                      <TableCell className="text-right text-xs">{c.completed_with_prize_count}</TableCell>
                      <TableCell className="text-right text-xs">{formatVND(c.total_archive_fee)}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{formatVND(c.total_revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">TỔNG CỘNG</TableCell>
                    <TableCell className="text-right">{clubSummary.reduce((s, c) => s + c.checked_in_count, 0)}</TableCell>
                    <TableCell className="text-right">{formatVND(clubSummary.reduce((s, c) => s + c.total_entry_fee, 0))}</TableCell>
                    <TableCell className="text-right">{clubSummary.reduce((s, c) => s + c.completed_with_prize_count, 0)}</TableCell>
                    <TableCell className="text-right">{formatVND(clubSummary.reduce((s, c) => s + c.total_archive_fee, 0))}</TableCell>
                    <TableCell className="text-right font-bold text-primary">{formatVND(clubSummary.reduce((s, c) => s + c.total_revenue, 0))}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </Card>
        )}

        {/* Detail Table */}
        <Card className="p-0 gradient-card border-primary/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">
            Chi tiết phiếu {clubFilter !== "all" && <span className="text-muted-foreground font-normal">— {allClubs.find((c) => c.id === clubFilter)?.name}</span>}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã / Ngày</TableHead>
                  <TableHead>Người tập huấn</TableHead>
                  <TableHead>SĐT</TableHead>
                  <TableHead>CLB</TableHead>
                  <TableHead className="text-right">Lệ phí</TableHead>
                  <TableHead className="text-right">Phí đầu vào</TableHead>
                  <TableHead className="text-right">Phí lưu trữ</TableHead>
                  <TableHead className="text-right">Tổng phí</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Không có dữ liệu phí trong khoảng thời gian này.</TableCell></TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.deal.id}>
                      <TableCell className="text-xs">
                        <div className="font-mono">#{r.deal.id.slice(0, 6).toUpperCase()}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {r.deal.player_checkin_at ? formatDateTime(r.deal.player_checkin_at) : formatDateTime(r.deal.created_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.deal.player?.display_name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{r.deal.custom_event_name ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">{maskPhone(r.deal.player?.phone)}</TableCell>
                      <TableCell className="text-xs">{r.deal.club?.name ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{formatVND(r.deal.buy_in_amount_vnd)}</TableCell>
                      <TableCell className="text-right text-xs">
                        <div>{formatVND(r.entryFee)}</div>
                        {r.entryCollected ? (
                          <Badge className="text-[9px] mt-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30" variant="secondary">Đã thu</Badge>
                        ) : (
                          <Badge className="text-[9px] mt-0.5 bg-muted text-muted-foreground" variant="secondary">Chưa check-in</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.archiveEligible ? (
                          <>
                            <div>{formatVND(r.archiveCollected)}</div>
                            <Badge className="text-[9px] mt-0.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30" variant="secondary">Đã thu</Badge>
                          </>
                        ) : r.deal.status === "completed" ? (
                          <Badge className="text-[9px] bg-muted text-muted-foreground" variant="secondary">Không phát sinh</Badge>
                        ) : (
                          <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/30" variant="secondary">Chưa đủ ĐK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{formatVND(r.totalCollected)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Coins className="w-3 h-3" />
          Ví dụ: Tour 3.300.000 → Phí đầu vào 49.000 (Player trả tại quầy khi check-in). Nếu thắng giải → cộng thêm phí lưu trữ 199.000 (trừ vào prize). Tổng phí 248.000.
        </div>
      </div>
    </div>
  );
};

export default FeeRevenueDashboard;
