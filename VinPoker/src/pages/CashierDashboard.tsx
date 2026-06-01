import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { exportToExcel, formatExcelDate } from "@/lib/exportExcel";
import CashierCounter from "@/components/admin/CashierCounter";
import ClubQrScanDialog from "@/components/ClubQrScanDialog";
import UnifiedLookupTab from "@/components/cashier/UnifiedLookupTab";
import SyncMembersTab from "@/components/cashier/SyncMembersTab";
import ClubCardQrTab from "@/components/cashier/ClubCardQrTab";
import RevenueReportTab from "@/components/cashier/RevenueReportTab";
import SwingPanel from "@/components/cashier/DealerSwingTab";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import {
  LayoutDashboard, Coins, Users as UsersIcon, FileBarChart, Loader2, CheckCircle2, XCircle,
  ScanLine, Wallet, Search, RefreshCw, Download, ImageIcon, IdCard, AlertTriangle,
  Table2, Calculator,
} from "lucide-react";

type ClubRow = { id: string; name: string };
type SectionKey = "overview" | "staking" | "members" | "reports" | "swing" | "payroll";

export default function CashierDashboard() {
  const { user, loading, isAdmin, isCashier } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = (params.get("tab") as SectionKey) || "overview";

  const [clubs, setClubs] = useState<ClubRow[] | null>(null);
  const [dealerClubIds, setDealerClubIds] = useState<string[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
    // Allow cashier, super_admin, OR club owners (detected via cashier_club_ids RPC below).
    // Final guard happens once `clubs` loads — empty + not admin → "chưa được phân công" screen.
  }, [loading, user, nav]);

  // load assigned clubs (RPC unions club_cashiers + clubs.owner_id)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: ids } = await supabase.rpc("cashier_club_ids", { _user_id: user.id });
      const idArr = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
      if (!idArr.length) { setClubs([]); return; }
      const { data: cs } = await supabase
        .from("clubs").select("id,name").in("id", idArr);
      setClubs((cs ?? []) as ClubRow[]);

      // Fetch dealer control club IDs for swing feature
      const { data: dcIds } = await supabase.rpc("dealer_control_club_ids", { _user_id: user.id });
      setDealerClubIds((dcIds ?? []).map((r: any) => (typeof r === "string" ? r : r.dealer_control_club_ids ?? r)));
    })();
  }, [user]);

  const setSection = (s: SectionKey) => {
    const p = new URLSearchParams(params); p.set("tab", s); setParams(p, { replace: true });
  };

  if (loading || !user) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền cashier cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const clubIds = clubs.map((c) => c.id);

  const navItems: { key: SectionKey; label: string; icon: any }[] = [
    { key: "overview", label: "Tổng quan", icon: LayoutDashboard },
    { key: "staking", label: "Staking", icon: Coins },
    { key: "members", label: "Thành viên", icon: UsersIcon },
    { key: "reports", label: "Doanh thu", icon: FileBarChart },
    ...(dealerClubIds.length > 0 ? [{ key: "swing" as SectionKey, label: "Dealer Swing", icon: Table2 }] : []),
    ...(dealerClubIds.length > 0 ? [{ key: "payroll" as SectionKey, label: "Bảng lương", icon: Calculator }] : []),
  ];

  return (
    <div className="container mx-auto p-3 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" /> Cashier CLB
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {clubs.length === 0 ? "Toàn quyền (Admin)" : `Phụ trách: ${clubs.map((c) => c.name).join(", ")}`}
            <span className="ml-2 italic">· App KHÔNG giữ tiền — chỉ ghi nhận trạng thái.</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-2">
          <Card className="p-2 md:sticky md:top-4">
            <nav className="flex md:flex-col gap-1">
              {navItems.map((it) => {
                const active = section === it.key;
                const Icon = it.icon;
                return (
                  <button
                    key={it.key}
                    onClick={() => setSection(it.key)}
                    className={
                      "flex-1 md:flex-none flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors " +
                      (active
                        ? "bg-primary/15 text-primary border border-primary/40 font-semibold"
                        : "text-muted-foreground hover:bg-muted/50")
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{it.label}</span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </aside>

        {/* Main */}
        <main className="col-span-12 md:col-span-9 lg:col-span-10 min-w-0">
          {section === "overview" && <OverviewPanel clubIds={clubIds} onJump={setSection} />}
          {section === "staking" && <StakingPanel clubIds={clubIds} />}
          {section === "members" && <MembersPanel clubIds={clubIds} clubs={clubs} />}
          {section === "reports" && <ReportsPanel clubIds={clubIds} clubs={clubs} />}
          {section === "swing" && <SwingPanel clubIds={dealerClubIds.length > 0 ? dealerClubIds : clubIds} clubs={clubs} />}
          {section === "payroll" && <DealerPayrollTab clubIds={dealerClubIds.length > 0 ? dealerClubIds : clubIds} clubs={clubs} />}
        </main>
      </div>
    </div>
  );
}

/* ============================================================== */
/* OVERVIEW                                                        */
/* ============================================================== */

function OverviewPanel({ clubIds, onJump }: { clubIds: string[]; onJump: (s: SectionKey) => void }) {
  const [stats, setStats] = useState<{ active: number; pending: number; pendingResults: number; checkins: number } | null>(null);

  const load = useCallback(async () => {
    setStats(null);
    if (clubIds.length === 0) {
      // admin – global counts
      const [a, p, r, c] = await Promise.all([
        supabase.from("staking_deals").select("id", { count: "exact", head: true }).in("status", ["funded", "committed"]),
        supabase.from("staking_purchases").select("id", { count: "exact", head: true }).eq("status", "committed"),
        supabase.from("staking_deals").select("id", { count: "exact", head: true }).eq("status", "funded"),
        supabase.from("staking_deals").select("id", { count: "exact", head: true }).eq("player_checked_in", true)
          .gte("player_checkin_at", startOfDayIso()),
      ]);
      setStats({ active: a.count ?? 0, pending: p.count ?? 0, pendingResults: r.count ?? 0, checkins: c.count ?? 0 });
      return;
    }
    const [a, p, r, c] = await Promise.all([
      supabase.from("staking_deals").select("id", { count: "exact", head: true }).in("club_id", clubIds).in("status", ["funded", "committed"]),
      supabase.from("staking_purchases").select("id, deal:staking_deals!inner(club_id)", { count: "exact", head: true })
        .eq("status", "committed").in("deal.club_id", clubIds),
      supabase.from("staking_deals").select("id", { count: "exact", head: true }).in("club_id", clubIds).eq("status", "funded"),
      supabase.from("staking_deals").select("id", { count: "exact", head: true }).in("club_id", clubIds)
        .eq("player_checked_in", true).gte("player_checkin_at", startOfDayIso()),
    ]);
    setStats({ active: a.count ?? 0, pending: p.count ?? 0, pendingResults: r.count ?? 0, checkins: c.count ?? 0 });
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const cards = [
    { label: "Active Deals", value: stats?.active, icon: Coins, color: "text-primary", click: () => onJump("staking") },
    { label: "Chờ xác nhận FUNDED", value: stats?.pending, icon: Loader2, color: "text-warning", click: () => onJump("staking") },
    { label: "Chờ kết quả", value: stats?.pendingResults, icon: CheckCircle2, color: "text-blue-400", click: () => onJump("staking") },
    { label: "Check-in hôm nay", value: stats?.checkins, icon: ScanLine, color: "text-success", click: () => onJump("staking") },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button key={c.label} onClick={c.click}
            className="text-left">
            <Card className="p-4 hover:border-primary/60 transition-colors h-full">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <c.icon className={"w-4 h-4 " + c.color} />
              </div>
              <div className="mt-2 text-2xl font-bold">
                {stats == null ? <Skeleton className="h-7 w-12" /> : c.value}
              </div>
            </Card>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Hướng dẫn nhanh</div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Làm mới</Button>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li><b>Chờ xác nhận:</b> Backer đã chuyển khoản vào TK CLB → đối chiếu sao kê → bấm "Xác nhận FUNDED".</li>
          <li><b>Check-in:</b> Quét QR (USB) hoặc tìm tên người chơi → thu tiền tự bỏ + phí cố định → "Xác nhận Check-in".</li>
          <li><b>Kết quả & Giải ngân:</b> Nhập thứ hạng + giải thưởng → trả tiền mặt cho Player → chuyển VND cho Backer → đánh dấu hoàn tất.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ============================================================== */
/* STAKING                                                         */
/* ============================================================== */

function StakingPanel({ clubIds }: { clubIds: string[] }) {
  return (
    <Tabs defaultValue="pending" className="w-full">
      <TabsList className="grid w-full grid-cols-2 md:grid-cols-6 h-auto">
        <TabsTrigger value="pending">Chờ xác nhận</TabsTrigger>
        <TabsTrigger value="checkin">Check-in</TabsTrigger>
        <TabsTrigger value="result">Kết quả & Giải ngân</TabsTrigger>
        <TabsTrigger value="history">Lịch sử</TabsTrigger>
        <TabsTrigger value="refund">Hoàn tiền</TabsTrigger>
        <TabsTrigger value="refund-history">Lịch sử hoàn tiền</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="mt-4"><PendingConfirmTab clubIds={clubIds} /></TabsContent>
      <TabsContent value="checkin" className="mt-4"><CashierCounter /></TabsContent>
      <TabsContent value="result" className="mt-4"><ResultPayoutTab clubIds={clubIds} /></TabsContent>
      <TabsContent value="history" className="mt-4"><HistoryTab clubIds={clubIds} /></TabsContent>
      <TabsContent value="refund" className="mt-4"><RefundTab clubIds={clubIds} /></TabsContent>
      <TabsContent value="refund-history" className="mt-4"><RefundHistoryTab clubIds={clubIds} /></TabsContent>
    </Tabs>
  );
}

function PendingConfirmTab({ clubIds }: { clubIds: string[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase
      .from("staking_purchases")
      .select(`
        id, deal_id, percent, amount_vnd, reference_code, transfer_proof_url,
        transfer_proof_submitted, status, committed_at, backer_id,
        deal:staking_deals!inner(
          id, club_id, custom_event_name, buy_in_amount_vnd, player_id
        )
      `)
      .eq("status", "committed")
      .order("committed_at", { ascending: true });
    if (clubIds.length) q = q.in("deal.club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setRows([]); return; }
    const arr = data ?? [];
    const ids = Array.from(new Set(arr.flatMap((r: any) => [r.backer_id, r.deal?.player_id]).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name, phone").in("user_id", ids);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setRows(arr.map((r: any) => ({
      ...r,
      backer: pmap[r.backer_id] ?? null,
      deal: r.deal ? { ...r.deal, player: pmap[r.deal.player_id] ?? null } : null,
    })));
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const confirm = async (purchase_id: string) => {
    setBusy(purchase_id);
    const { data, error } = await supabase.functions.invoke("admin-confirm-funded", {
      body: { purchase_id },
    });
    setBusy(null);
    if (error || (data as any)?.error) { toast.error(error?.message ?? (data as any).error); return; }
    toast.success("Đã xác nhận FUNDED");
    load();
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Backer đã chuyển khoản — chờ đối chiếu ({rows.length})</div>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <p className="text-[11px] text-warning mb-3">
        ⚠️ Chỉ xác nhận khi tiền đã thật sự vào tài khoản CLB. App KHÔNG giữ tiền.
      </p>
      {rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Không có yêu cầu chờ xác nhận</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const left = r.committed_at ? Math.max(0, 30 - Math.floor((Date.now() - new Date(r.committed_at).getTime()) / 60000)) : 0;
            return (
              <div key={r.id} className="rounded-lg border bg-muted/20 p-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-sm font-semibold truncate">
                    {r.deal?.custom_event_name ?? "—"} <span className="text-muted-foreground">· {r.percent}% · {formatVND(r.amount_vnd)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Player: {r.deal?.player?.display_name ?? "—"} · Backer: {r.backer?.display_name ?? "—"}
                  </div>
                  <div className="text-xs flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono">{r.reference_code}</Badge>
                    <span className="text-muted-foreground">⏱ còn {left} phút</span>
                    {r.transfer_proof_url ? (
                      <a href={r.transfer_proof_url} target="_blank" rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" /> xem biên lai
                      </a>
                    ) : (
                      <span className="text-warning">chưa có biên lai</span>
                    )}
                  </div>
                </div>
                <Button size="sm" disabled={busy === r.id} onClick={() => confirm(r.id)}>
                  {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  Xác nhận FUNDED
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ResultPayoutTab({ clubIds }: { clubIds: string[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [cardMap, setCardMap] = useState<Record<string, string>>({});
  const [clubFilter, setClubFilter] = useState<string | null>(null);
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (!clubIds.length) { setClubNames({}); return; }
    (async () => {
      const { data } = await supabase.from("clubs").select("id,name").in("id", clubIds);
      setClubNames(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.name])));
    })();
  }, [clubIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from("staking_deals")
      .select(`id, status, custom_event_name, club_id, buy_in_amount_vnd, result_prize_vnd, filled_percent, player_id`)
      .in("status", ["funded", "result_entered", "result_verified", "release_requested"])
      .order("updated_at", { ascending: false });
    if (clubFilter) q = q.eq("club_id", clubFilter);
    else if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setRows([]); return; }
    const arr = data ?? [];
    const ids = Array.from(new Set(arr.map((r: any) => r.player_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    const cmap: Record<string, string> = {};
    if (ids.length && clubIds.length) {
      const { data: mvr } = await supabase
        .from("membership_verification_requests")
        .select("player_user_id, club_id, member_card_id, reviewed_at")
        .eq("status", "approved")
        .in("player_user_id", ids)
        .in("club_id", clubIds)
        .order("reviewed_at", { ascending: false });
      (mvr ?? []).forEach((m: any) => {
        const k = `${m.player_user_id}:${m.club_id}`;
        if (!cmap[k]) cmap[k] = m.member_card_id;
      });
    }
    setCardMap(cmap);
    setRows(arr.map((r: any) => ({ ...r, player: pmap[r.player_id] ?? null })));
  }, [clubIds, clubFilter]);

  useEffect(() => { load(); }, [load]);

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="text-sm font-semibold">Deals đang thi đấu / chờ giải ngân ({rows.length})</div>
        <div className="flex items-center gap-2 flex-wrap">
          {clubFilter && (
            <Badge variant="secondary" className="gap-1">
              CLB: {clubNames[clubFilter] ?? clubFilter.slice(0, 6)}
              <button className="ml-1 hover:text-destructive" onClick={() => setClubFilter(null)} aria-label="Clear filter">
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}>
            <ScanLine className="w-3.5 h-3.5 mr-1" />Quét thẻ CLB
          </Button>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Mở chi tiết tại <span className="font-semibold">Quản trị → Staking → Kết quả & Giải ngân</span> để nhập thứ hạng,
        upload ảnh bảng giải, và đánh dấu đã trả Player / đã chuyển Backer. Phí giải ngân theo cấu hình hiện hành (snapshot per-deal).
      </p>
      <ClubQrScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        allowedClubIds={clubIds}
        onPicked={(id) => { setClubFilter(id); toast.success(`Đã lọc theo CLB: ${clubNames[id] ?? id.slice(0, 8)}`); }}
      />
      {rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Không có deal đang thi đấu</div>
      ) : (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sự kiện</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Buy-in</TableHead>
                <TableHead>Đã bán</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const card = cardMap[`${r.player_id}:${r.club_id}`];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.custom_event_name ?? "—"}</TableCell>
                    <TableCell>
                      <div>{r.player?.display_name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        Mã thẻ: {card ?? <span className="italic">Chưa xác minh</span>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{formatVND(r.buy_in_amount_vnd)}</TableCell>
                    <TableCell>{r.filled_percent}%</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <a href={`/admin/staking?deal=${r.id}`}>Mở</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function HistoryTab({ clubIds }: { clubIds: string[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from("staking_deals")
      .select(`id, custom_event_name, status, created_at, result_prize_vnd, filled_percent, club_id, player_id`)
      .in("status", ["completed", "cancelled"])
      .order("updated_at", { ascending: false })
      .limit(500);
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setRows([]); return; }
    const arr = data ?? [];
    const ids = Array.from(new Set(arr.map((r: any) => r.player_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setRows(arr.map((r: any) => ({ ...r, player: pmap[r.player_id] ?? null })));
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.custom_event_name ?? "").toLowerCase().includes(s) ||
      (r.player?.display_name ?? "").toLowerCase().includes(s) ||
      r.id.includes(s));
  }, [rows, search]);

  const exportXlsx = () => {
    exportToExcel(filtered, [
      { header: "Deal ID", get: (r: any) => r.id.slice(0, 8) },
      { header: "Sự kiện", get: (r: any) => r.custom_event_name ?? "" },
      { header: "Player", get: (r: any) => r.player?.display_name ?? "" },
      { header: "Ngày", get: (r: any) => formatExcelDate(r.created_at) },
      { header: "Tổng giải", get: (r: any) => r.result_prize_vnd ?? 0 },
      { header: "% bán", get: (r: any) => r.filled_percent },
      { header: "Trạng thái", get: (r: any) => r.status },
    ], "lich-su-staking", "History");
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Input placeholder="Tìm theo player / sự kiện / Deal ID"
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs" />
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        <Button size="sm" onClick={exportXlsx} disabled={filtered.length === 0}>
          <Download className="w-3.5 h-3.5 mr-1" /> Excel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} dòng</span>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sự kiện</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Ngày</TableHead>
              <TableHead>Tổng giải</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Không có dữ liệu</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.custom_event_name ?? "—"}</TableCell>
                <TableCell>{r.player?.display_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{formatDateTime(r.created_at)}</TableCell>
                <TableCell className="font-mono">{r.result_prize_vnd ? formatVND(r.result_prize_vnd) : "—"}</TableCell>
                <TableCell>{r.filled_percent}%</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ============================================================== */
/* MEMBERS                                                         */
/* ============================================================== */

function MembersPanel({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const [params, setParams] = useSearchParams();
  const allowed = ["lookup", "sync", "qr", "verify", "reissue"] as const;
  const sub = (params.get("sub") as typeof allowed[number]) || "lookup";
  const value = allowed.includes(sub) ? sub : "lookup";
  const onChange = (v: string) => {
    const p = new URLSearchParams(params); p.set("sub", v); setParams(p, { replace: true });
  };
  return (
    <Tabs value={value} onValueChange={onChange} className="w-full">
      <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto">
        <TabsTrigger value="lookup">Tra cứu</TabsTrigger>
        <TabsTrigger value="sync">Đồng bộ</TabsTrigger>
        <TabsTrigger value="qr">QR thẻ CLB</TabsTrigger>
        <TabsTrigger value="verify">Yêu cầu xác minh</TabsTrigger>
        <TabsTrigger value="reissue">Cấp lại thẻ</TabsTrigger>
      </TabsList>
      <TabsContent value="lookup" className="mt-4"><UnifiedLookupTab clubIds={clubIds} clubs={clubs} /></TabsContent>
      <TabsContent value="sync" className="mt-4"><SyncMembersTab clubs={clubs} /></TabsContent>
      <TabsContent value="qr" className="mt-4"><ClubCardQrTab clubs={clubs} /></TabsContent>
      <TabsContent value="verify" className="mt-4"><VerificationRequestsTab clubIds={clubIds} clubs={clubs} /></TabsContent>
      <TabsContent value="reissue" className="mt-4"><CardReissueTab /></TabsContent>
    </Tabs>
  );
}

function VerificationRequestsTab({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const clubName = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c.name])), [clubs]);

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from("membership_verification_requests")
      .select(`id, member_card_id, status, created_at, club_id, player_user_id,
               player:profiles!membership_verification_requests_player_user_id_fkey(display_name, phone, avatar_url)`)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) {
      // FK alias may not exist; fallback to manual lookup
      let q2 = supabase.from("membership_verification_requests")
        .select("id, member_card_id, status, created_at, club_id, player_user_id")
        .eq("status", "pending").order("created_at", { ascending: true });
      if (clubIds.length) q2 = q2.in("club_id", clubIds);
      const { data: d2 } = await q2;
      const ids = Array.from(new Set((d2 ?? []).map((r: any) => r.player_user_id)));
      let profiles: Record<string, any> = {};
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("user_id, display_name, phone, avatar_url").in("user_id", ids);
        profiles = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
      }
      setRows((d2 ?? []).map((r: any) => ({ ...r, player: profiles[r.player_user_id] })));
      return;
    }
    setRows(data ?? []);
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject", reason?: string) => {
    setBusy(id);
    const { data, error } = await supabase.rpc("approve_verification", {
      p_request_id: id,
      p_action: action,
      p_rejection_reason: reason ?? null,
    });
    setBusy(null);
    if (error || (data as any)?.error) { toast.error(error?.message ?? (data as any).error); return; }
    toast.success(action === "approve" ? "✅ Đã duyệt — người chơi đã được xác minh." : "❌ Đã từ chối yêu cầu.");
    setRejectFor(null); setRejectReason("");
    load();
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <>
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Yêu cầu chờ duyệt ({rows.length})</div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
        {rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">Không có yêu cầu đang chờ</div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Người chơi</TableHead>
                  <TableHead>Mã thẻ</TableHead>
                  {clubs.length > 1 && <TableHead>CLB</TableHead>}
                  <TableHead>Ngày yêu cầu</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.player?.display_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.player?.phone ?? ""}</div>
                    </TableCell>
                    <TableCell className="font-mono">{r.member_card_id}</TableCell>
                    {clubs.length > 1 && <TableCell className="text-xs">{clubName[r.club_id] ?? "—"}</TableCell>}
                    <TableCell className="text-xs">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" disabled={busy === r.id}
                          className="bg-success hover:bg-success/90 text-success-foreground"
                          onClick={() => act(r.id, "approve")}>
                          {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                          Phê duyệt
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy === r.id}
                          onClick={() => { setRejectFor(r); setRejectReason(""); }}>
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Từ chối
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối yêu cầu xác minh</DialogTitle>
            <DialogDescription>
              Nhập lý do để gửi cho người chơi {rejectFor?.player?.display_name ?? ""}.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="VD: Mã thẻ không khớp với hồ sơ CLB"
            value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Huỷ</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || busy === rejectFor?.id}
              onClick={() => act(rejectFor.id, "reject", rejectReason.trim())}>
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LookupTab({ clubIds }: { clubIds: string[] }) {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  const search = async () => {
    const s = term.trim();
    if (s.length < 2) { toast.error("Nhập ít nhất 2 ký tự"); return; }
    setLoading(true);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone, avatar_url, verification_status")
      .or(`display_name.ilike.%${s}%,phone.ilike.%${s}%`)
      .limit(20);
    setLoading(false);
    setResults(profiles ?? []);
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Tên hiển thị / SĐT / Mã thẻ"
          value={term} onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()} />
        <Button onClick={search} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>
      {results === null ? (
        <p className="text-xs text-muted-foreground">Tìm để hiển thị kết quả.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-center text-muted-foreground py-6">Không tìm thấy</p>
      ) : (
        <div className="space-y-1.5">
          {results.map((p) => (
            <div key={p.user_id} className="flex items-center gap-3 p-2 rounded-lg border">
              <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <UsersIcon className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {p.display_name ?? "—"}
                  {p.verification_status === "verified" && (
                    <Badge className="bg-success/15 text-success border-success/40 text-[10px]">✓ Đã xác minh</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{p.phone ?? "—"}</div>
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href={`/player/${p.user_id}`} target="_blank" rel="noreferrer">Hồ sơ</a>
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CardReissueTab() {
  return (
    <Card className="p-10 text-center space-y-3">
      <IdCard className="w-12 h-12 mx-auto text-muted-foreground" />
      <div className="text-lg font-semibold">🪪 Tính năng sắp ra mắt</div>
      <p className="text-sm text-muted-foreground">Cấp lại thẻ thành viên sẽ được tích hợp với máy in thẻ của CLB.</p>
    </Card>
  );
}

/* ============================================================== */
/* REPORTS                                                         */
/* ============================================================== */

function ReportsPanel({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  return <RevenueReportTab clubIds={clubIds} clubs={clubs} />;
}

/* ============================================================== */
/* REFUND                                                          */
/* ============================================================== */

function RefundTab({ clubIds }: { clubIds: string[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from("staking_deals")
      .select(`id, custom_event_name, club_id, buy_in_amount_vnd, filled_percent, percentage_sold, status, player_id, created_at,
               tournament:tournament_id(name, start_time)`)
      .in("status", ["funded", "locked", "result_entered", "result_verified"])
      .order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setRows([]); return; }
    const arr = data ?? [];
    const ids = Array.from(new Set(arr.map((r: any) => r.player_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setRows(arr.map((r: any) => ({ ...r, player: pmap[r.player_id] ?? null })));
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const doRefund = async () => {
    if (!refundFor || !refundReason.trim()) return;
    setBusy(refundFor.id);
    const { data, error } = await supabase.functions.invoke("staking-process-refund", {
      body: { deal_id: refundFor.id, reason: refundReason.trim() },
    });
    setBusy(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? error?.message ?? "Lỗi hoàn tiền");
      return;
    }
    toast.success("✅ Đã hoàn trả phí hỗ trợ tập huấn cho tất cả backer.");
    setRefundFor(null);
    setRefundReason("");
    load();
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <>
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Deals đã funded — có thể hoàn tiền ({rows.length})</div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
        <p className="text-[11px] text-warning mb-3">
          ⚠️ Hoàn tiền sẽ trả lại toàn bộ số tiền backer đã góp, trừ phí nền tảng (nếu có). Hành động này không thể hoàn tác.
        </p>
        {rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">Không có deal nào đã funded</div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sự kiện</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Buy-in</TableHead>
                  <TableHead>Đã bán</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.custom_event_name ?? r.tournament?.name ?? "—"}</TableCell>
                    <TableCell>{r.player?.display_name ?? "—"}</TableCell>
                    <TableCell className="font-mono">{formatVND(r.buy_in_amount_vnd)}</TableCell>
                    <TableCell>{r.filled_percent}% / {r.percentage_sold}%</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="destructive"
                        onClick={() => { setRefundFor(r); setRefundReason(""); }}>
                        Hoàn tiền
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!refundFor} onOpenChange={(o) => !o && setRefundFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận hoàn tiền</DialogTitle>
            <DialogDescription>
              Hoàn trả phí hỗ trợ tập huấn cho tất cả backer của deal <b>{refundFor?.custom_event_name ?? refundFor?.tournament?.name ?? ""}</b>.
              <br />Số tiền: <b>{refundFor?.buy_in_amount_vnd ? formatVND(refundFor.buy_in_amount_vnd) : "—"}</b>
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Lý do hoàn tiền (bắt buộc)"
            value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundFor(null)}>Huỷ</Button>
            <Button variant="destructive" disabled={!refundReason.trim() || busy === refundFor?.id}
              onClick={doRefund}>
              {busy === refundFor?.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Xác nhận hoàn tiền
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RefundHistoryTab({ clubIds }: { clubIds: string[] }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from("staking_deals")
      .select(`id, custom_event_name, status, created_at, refund_reason, refunded_at, refunded_by, buy_in_amount_vnd, filled_percent, club_id, player_id,
               tournament:tournament_id(name)`)
      .eq("status", "deal_refunded")
      .order("refunded_at", { ascending: false })
      .limit(500);
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setRows([]); return; }
    const arr = data ?? [];
    const ids = Array.from(new Set(arr.map((r: any) => r.player_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setRows(arr.map((r: any) => ({ ...r, player: pmap[r.player_id] ?? null })));
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.custom_event_name ?? "").toLowerCase().includes(s) ||
      (r.player?.display_name ?? "").toLowerCase().includes(s) ||
      (r.refund_reason ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  const exportXlsx = () => {
    exportToExcel(filtered, [
      { header: "Deal ID", get: (r: any) => r.id.slice(0, 8) },
      { header: "Sự kiện", get: (r: any) => r.custom_event_name ?? r.tournament?.name ?? "" },
      { header: "Player", get: (r: any) => r.player?.display_name ?? "" },
      { header: "Buy-in", get: (r: any) => r.buy_in_amount_vnd ?? 0 },
      { header: "% lấp đầy", get: (r: any) => r.filled_percent },
      { header: "Lý do", get: (r: any) => r.refund_reason ?? "" },
      { header: "Ngày hoàn", get: (r: any) => formatExcelDate(r.refunded_at) },
    ], "lich-su-hoan-tien", "RefundHistory");
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Input placeholder="Tìm theo player / sự kiện / lý do"
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs" />
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        <Button size="sm" onClick={exportXlsx} disabled={filtered.length === 0}>
          <Download className="w-3.5 h-3.5 mr-1" /> Excel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} dòng</span>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sự kiện</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Buy-in</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Lý do</TableHead>
              <TableHead>Ngày hoàn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Không có dữ liệu</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.custom_event_name ?? r.tournament?.name ?? "—"}</TableCell>
                <TableCell>{r.player?.display_name ?? "—"}</TableCell>
                <TableCell className="font-mono">{r.buy_in_amount_vnd ? formatVND(r.buy_in_amount_vnd) : "—"}</TableCell>
                <TableCell>{r.filled_percent}%</TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{r.refund_reason ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.refunded_at ? formatDateTime(r.refunded_at) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ============================================================== */
/* utils                                                           */
/* ============================================================== */

function startOfDayIso() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
