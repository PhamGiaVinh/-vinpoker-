import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ChipDisc } from "./ChipDisc";
import { ArrowDown, ArrowUp, Loader2, Vault } from "lucide-react";

// chip_ops_* bank objects are applied live but not in generated types → loose client.
const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Forbidden: "Bạn không có quyền.",
  Unauthorized: "Bạn chưa đăng nhập.",
  BANK_NEGATIVE: "Không đủ chip trong két để xuất.",
  race_lost: "Số liệu vừa thay đổi, mở lại và thử lại.",
  DENOM_NOT_IN_CLUB: "Mệnh giá không thuộc CLB.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
};

interface BankDenom { denomination_id: string; value: number; color: string | null; on_hand_count: number; version: number }
interface LedgerRow { id: string; denomination_id: string; direction: string; count: number; balance_after: number; created_at: string }

async function callRpc(fn: string, args: Record<string, unknown>): Promise<any | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) { toast.error("Tính năng két chưa bật trên máy chủ."); return null; }
    if (data && data.error) { toast.error(ERR[data.error] ?? data.error); return null; }
    return data ?? {};
  } catch { toast.error("Có lỗi xảy ra, thử lại."); return null; }
}

/** Két / Audit — club-level chip bank (Model B = manual): balances + xuất/thu + append-only log. */
export function BankAuditTab({ clubId, tournamentId }: { clubId: string | null; tournamentId: string }) {
  const [bank, setBank] = useState<BankDenom[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denomId, setDenomId] = useState("");
  const [dir, setDir] = useState<"thu" | "xuat">("thu");
  const [count, setCount] = useState("");

  const reload = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const b = await callRpc("get_chip_bank", { p_club_id: clubId });
    setBank(b && !b.error ? (b.denominations as BankDenom[]) : []);
    const { data: lg } = await sb.from("chip_bank_ledger")
      .select("id,denomination_id,direction,count,balance_after,created_at")
      .eq("club_id", clubId).order("created_at", { ascending: false }).limit(50);
    setLedger((lg ?? []) as LedgerRow[]);
    setLoading(false);
  }, [clubId]);

  useEffect(() => { reload(); }, [reload]);

  const valueOf = (id: string) => bank.find((d) => d.denomination_id === id)?.value ?? 0;

  const submit = async () => {
    const n = Number(count);
    const d = bank.find((x) => x.denomination_id === denomId);
    if (!d || !Number.isFinite(n) || n <= 0) { toast.error("Chọn mệnh giá và nhập số chip > 0."); return; }
    setBusy(true);
    const r = await callRpc("chip_ops_bank_adjust", {
      p_club_id: clubId,
      p_denomination_id: denomId,
      p_direction: dir,
      p_count: n,
      p_tournament_id: tournamentId || null,
      p_old_version: d.version,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (r?.status === "ok") { toast.success(dir === "thu" ? "Đã thu chip vào két." : "Đã xuất chip khỏi két."); setCount(""); reload(); }
    setBusy(false);
  };

  if (!clubId) {
    return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để xác định CLB của két.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
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
                  <div className="font-display text-sm font-bold tabular-nums text-foreground">{fmt(d.on_hand_count)}</div>
                  <div className="text-[11px] text-muted-foreground">T{fmt(d.value)}</div>
                </div>
              ))}
            </div>
          )}
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
                <TableHead className="text-right">Số chip</TableHead><TableHead className="text-right">Tồn sau</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("vi-VN")}</TableCell>
                    <TableCell className="tabular-nums">T{fmt(valueOf(e.denomination_id))}</TableCell>
                    <TableCell>{e.direction === "thu" ? <span className="text-primary">Thu</span> : <span className="text-warning">Xuất</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(e.count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(e.balance_after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
