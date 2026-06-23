import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChipDisc } from "./ChipDisc";
import { ArrowDown, ArrowUp, Loader2, Vault, Zap, RefreshCw, Info } from "lucide-react";

// chip_ops_* bank objects are applied live but not in generated types → loose client.
const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Forbidden: "Bạn không có quyền.",
  Unauthorized: "Bạn chưa đăng nhập.",
  BANK_NEGATIVE: "Không đủ chip trong két để xuất (thủ công).",
  race_lost: "Số liệu vừa thay đổi, mở lại và thử lại.",
  DENOM_NOT_IN_CLUB: "Mệnh giá không thuộc CLB.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
};
// bank-ledger reason → friendly label
const REASON: Record<string, string> = {
  manual: "Thủ công",
  couple_issuance: "Phát chip (tự động)",
  couple_color_up: "Color-up (tự động)",
  couple_color_up_reverse: "Hoàn color-up (tự động)",
  sync: "Đồng bộ",
};

interface BankDenom { denomination_id: string; value: number; color: string | null; on_hand_count: number; version: number }
interface LedgerRow { id: string; denomination_id: string; direction: string; count: number; balance_after: number; reason: string | null; created_at: string }
interface SyncRow { denomination_id: string; total: number; in_play: number; on_hand: number }

async function callRpc(fn: string, args: Record<string, unknown>): Promise<any | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) { toast.error("Tính năng két chưa bật trên máy chủ."); return null; }
    if (data && data.error) { toast.error(ERR[data.error] ?? data.error); return null; }
    return data ?? {};
  } catch { toast.error("Có lỗi xảy ra, thử lại."); return null; }
}

// on-hand count: negative = a deficit (ghi nợ) under auto-coupling → render red.
function OnHand({ n, className = "" }: { n: number; className?: string }) {
  const neg = n < 0;
  return <span className={`tabular-nums ${neg ? "text-destructive" : "text-foreground"} ${className}`}>{fmt(n)}{neg ? " (ghi nợ)" : ""}</span>;
}

/** Két / Audit — club chip bank: balances + manual xuất/thu + auto-coupling (Model A) toggle + đồng bộ + log. */
export function BankAuditTab({ clubId, tournamentId }: { clubId: string | null; tournamentId: string }) {
  const [bank, setBank] = useState<BankDenom[]>([]);
  const [coupling, setCoupling] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denomId, setDenomId] = useState("");
  const [dir, setDir] = useState<"thu" | "xuat">("thu");
  const [count, setCount] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncTotals, setSyncTotals] = useState<Record<string, string>>({});
  const [syncResult, setSyncResult] = useState<{ rows: SyncRow[]; tours: { name: string | null }[] } | null>(null);

  const reload = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const b = await callRpc("get_chip_bank", { p_club_id: clubId });
    setBank(b && !b.error ? (b.denominations as BankDenom[]) : []);
    setCoupling(!!(b && !b.error && b.coupling_enabled));
    const { data: lg } = await sb.from("chip_bank_ledger")
      .select("id,denomination_id,direction,count,balance_after,reason,created_at")
      .eq("club_id", clubId).order("created_at", { ascending: false }).limit(50);
    setLedger((lg ?? []) as LedgerRow[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => { reload(); }, [reload]);

  const valueOf = (id: string) => bank.find((d) => d.denomination_id === id)?.value ?? 0;
  const hasDeficit = useMemo(() => bank.some((d) => d.on_hand_count < 0), [bank]);

  const submit = async () => {
    const n = Number(count);
    const d = bank.find((x) => x.denomination_id === denomId);
    if (!d || !Number.isFinite(n) || n <= 0) { toast.error("Chọn mệnh giá và nhập số chip > 0."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_bank_adjust", {
      p_club_id: clubId, p_denomination_id: denomId, p_direction: dir, p_count: n,
      p_tournament_id: tournamentId || null, p_old_version: d.version, p_idempotency_key: crypto.randomUUID(),
    });
    if (r?.status === "ok") { toast.success(dir === "thu" ? "Đã thu chip vào két." : "Đã xuất chip khỏi két."); setCount(""); reload(); }
    setBusy(false);
  };

  const toggleCoupling = async (enabled: boolean) => {
    setBusy(true);
    const r = await callRpc("chip_ops_set_bank_coupling", { p_club_id: clubId, p_enabled: enabled });
    if (r?.status === "ok") { setCoupling(enabled); toast.success(enabled ? "Đã bật két tự động." : "Đã tắt két tự động."); }
    setBusy(false);
  };

  const runSync = async () => {
    const totals = bank
      .map((d) => ({ denomination_id: d.denomination_id, total: Number(syncTotals[d.denomination_id]) }))
      .filter((x) => Number.isFinite(x.total) && x.total >= 0);
    if (totals.length === 0) { toast.error("Nhập tổng số chip sở hữu cho ít nhất một mệnh giá."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_bank_sync", { p_club_id: clubId, p_totals: totals });
    if (r?.status === "ok") {
      setSyncResult({ rows: (r.denominations ?? []) as SyncRow[], tours: (r.tournaments_counted ?? []) as { name: string | null }[] });
      toast.success("Đã đồng bộ kho két.");
      reload();
    }
    setBusy(false);
  };

  if (!clubId) {
    return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để xác định CLB của két.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {/* auto-coupling (Model A) */}
      <Card className="border-border">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap className={`h-4 w-4 ${coupling ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium text-foreground">Két tự động (Model A)</div>
                <div className="text-xs text-muted-foreground">Phát chip tự trừ két · color-up tự thu/xuất.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setSyncResult(null); setSyncOpen(true); }}>
                <RefreshCw className="h-4 w-4" /> Đồng bộ kho két
              </Button>
              <Switch checked={coupling} disabled={busy} onCheckedChange={toggleCoupling} aria-label="Bật két tự động" />
            </div>
          </div>
          {coupling && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div>
                Đang BẬT: mỗi lần <b className="text-foreground">phát stack</b> sẽ tự <b className="text-foreground">xuất</b> chip khỏi két, và <b className="text-foreground">color-up</b> tự <b className="text-foreground">thu</b> chip nhỏ về + <b className="text-foreground">xuất</b> chip lớn. Két thiếu thì hiện <span className="text-destructive">ghi nợ</span> (vẫn cho làm). Hãy bấm <b className="text-foreground">Đồng bộ kho két</b> để số trong két khớp thực tế.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-foreground"><Vault className="h-4 w-4 text-primary" /> Tồn kho két chip (CLB)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-20 w-full" /> : bank.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có mệnh giá trong CLB (hoặc tính năng két chưa bật trên máy chủ). Tạo bộ chip ở tab <b className="text-foreground">Setup stack</b> trước.</p>
          ) : (
            <div className="flex flex-wrap gap-5">
              {bank.map((d) => (
                <div key={d.denomination_id} className="flex w-20 flex-col items-center gap-2">
                  <ChipDisc value={d.value} color={d.color} size={48} />
                  <div className="font-display text-sm font-bold"><OnHand n={d.on_hand_count} /></div>
                  <div className="text-[11px] text-muted-foreground">T{fmt(d.value)}</div>
                </div>
              ))}
            </div>
          )}
          {hasDeficit && <p className="mt-3 text-xs text-destructive">Có mệnh giá đang <b>ghi nợ</b> (két âm) — nạp thêm chip hoặc đồng bộ lại kho két.</p>}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Xuất / Thu thủ công</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="text-xs">Mệnh giá</Label>
            <Select value={denomId} onValueChange={setDenomId}>
              <SelectTrigger><SelectValue placeholder="Chọn mệnh giá" /></SelectTrigger>
              <SelectContent>{bank.map((d) => <SelectItem key={d.denomination_id} value={d.denomination_id}>T{fmt(d.value)} · tồn {fmt(d.on_hand_count)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Chiều</Label>
            <Select value={dir} onValueChange={(v) => setDir(v as "thu" | "xuat")}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thu">Thu vào</SelectItem>
                <SelectItem value="xuat">Xuất ra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Số chip</Label>
            <Input type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="0" className="w-32" />
          </div>
          <Button onClick={submit} disabled={busy || !denomId || !count}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : dir === "thu" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            {dir === "thu" ? "Thu" : "Xuất"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Nhật ký xuất / thu</CardTitle></CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có sự kiện nào.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Thời gian</TableHead><TableHead>Mệnh giá</TableHead><TableHead>Chiều</TableHead>
                <TableHead>Nguồn</TableHead><TableHead className="text-right">Số chip</TableHead><TableHead className="text-right">Tồn sau</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("vi-VN")}</TableCell>
                    <TableCell className="tabular-nums">T{fmt(valueOf(e.denomination_id))}</TableCell>
                    <TableCell>{e.direction === "thu" ? <span className="text-primary">Thu</span> : <span className="text-warning">Xuất</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{REASON[e.reason ?? "manual"] ?? e.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(e.count)}</TableCell>
                    <TableCell className="text-right"><OnHand n={e.balance_after} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Đồng bộ kho két */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Đồng bộ kho két</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Nhập <b className="text-foreground">tổng số chip CLB sở hữu</b> mỗi mệnh giá. App tự trừ phần đang chơi (các giải đang chạy) để ra số còn trong két.</p>
          <div className="space-y-2">
            {bank.map((d) => (
              <div key={d.denomination_id} className="flex items-center gap-3">
                <ChipDisc value={d.value} color={d.color} size={32} />
                <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground">T{fmt(d.value)}</span>
                <Input type="number" inputMode="numeric" min={0} value={syncTotals[d.denomination_id] ?? ""}
                  onChange={(e) => setSyncTotals((s) => ({ ...s, [d.denomination_id]: e.target.value }))}
                  placeholder="tổng sở hữu" className="h-9" />
              </div>
            ))}
          </div>
          {syncResult && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="mb-1 text-muted-foreground">Đã tính (đang chơi ở: {syncResult.tours.map((t) => t.name ?? "—").join(", ") || "không có giải đang chạy"}):</div>
              <Table>
                <TableHeader><TableRow><TableHead>Mệnh giá</TableHead><TableHead className="text-right">Sở hữu</TableHead><TableHead className="text-right">Đang chơi</TableHead><TableHead className="text-right">Trong két</TableHead></TableRow></TableHeader>
                <TableBody>
                  {syncResult.rows.map((r) => (
                    <TableRow key={r.denomination_id}>
                      <TableCell className="tabular-nums">T{fmt(valueOf(r.denomination_id))}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.in_play)}</TableCell>
                      <TableCell className="text-right"><OnHand n={r.on_hand} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSyncOpen(false)}>Đóng</Button>
            <Button disabled={busy} onClick={runSync}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Đồng bộ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
