import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Stepper } from "./Stepper";
import { ArrowRight, CheckCircle2, Loader2, Undo2 } from "lucide-react";

const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");
const ERR: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.",
  Forbidden: "Bạn không có quyền.",
  SAME_DENOM: "Mệnh giá rút và nhận phải khác nhau.",
  NOT_RACING_UP: "Phải race LÊN mệnh giá cao hơn.",
  NOTHING_TO_REMOVE: "Mệnh giá này không còn chip để rút.",
  VALUE_NOT_CONSERVED: "Số chip nhận không khớp giá trị rút (lệch ≥ 1 chip mục tiêu). Kiểm tra lại.",
  ALREADY_DONE: "Mệnh giá này đã color-up ở level này rồi.",
  DENOM_NOT_IN_SET: "Mệnh giá không thuộc bộ chip của giải.",
  TOURNAMENT_NOT_FOUND: "Không tìm thấy giải.",
  OPERATION_NOT_FOUND: "Không tìm thấy thao tác.",
  INVALID_INPUT: "Dữ liệu nhập chưa hợp lệ.",
};
async function callRpc(fn: string, args: Record<string, unknown>): Promise<any | null> {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) { toast.error("Tính năng color-up chưa bật trên máy chủ."); return null; }
    if (data && data.error) { toast.error(ERR[data.error] ?? data.error); return null; }
    return data ?? {};
  } catch { toast.error("Có lỗi xảy ra, thử lại."); return null; }
}

interface Denom { denomination_id: string; value: number; color: string | null; current_count: number }
interface HistoryOp {
  id: string; level_number: number; status: string; denom_removed_value: number; denom_target_value: number;
  removed_count: number; target_added: number; rounding_delta: number;
}

export function ColorUpTab({ tournamentId, clubId }: { tournamentId: string; clubId: string | null }) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denoms, setDenoms] = useState<Denom[]>([]);
  const [bigBlind, setBigBlind] = useState<number | null>(null);
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryOp[]>([]);
  const [removedId, setRemovedId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [added, setAdded] = useState("");

  const reload = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    const inv = await callRpc("get_current_chip_inventory", { p_tournament_id: tournamentId });
    setDenoms(inv && !inv.error
      ? (inv.denominations || []).map((d: any) => ({ denomination_id: d.denomination_id, value: d.value, color: d.color, current_count: Number(d.current_count) }))
      : []);
    const { data: t } = await sb.from("tournaments").select("current_level").eq("id", tournamentId).maybeSingle();
    setCurrentLevel(t?.current_level ?? null);
    if (t?.current_level != null) {
      const { data: l } = await sb.from("tournament_levels").select("big_blind").eq("tournament_id", tournamentId).eq("level_number", t.current_level).maybeSingle();
      setBigBlind(l?.big_blind ?? null);
    } else setBigBlind(null);
    const h = await callRpc("get_color_up_history", { p_tournament_id: tournamentId });
    setHistory(h && !h.error ? (h.operations || []) : []);
    setLoading(false);
  }, [tournamentId]);
  useEffect(() => { reload(); }, [reload]);

  const sorted = useMemo(() => [...denoms].sort((a, b) => a.value - b.value), [denoms]);
  const removed = denoms.find((d) => d.denomination_id === removedId);
  const target = denoms.find((d) => d.denomination_id === targetId);
  const confirmedValues = useMemo(
    () => new Set(history.filter((h) => h.status === "confirmed").map((h) => h.denom_removed_value)),
    [history],
  );

  // when removed changes: default target = next higher, clear added (will pre-fill below)
  useEffect(() => {
    if (!removed) { setTargetId(""); return; }
    const nh = sorted.find((d) => d.value > removed.value);
    setTargetId(nh ? nh.denomination_id : "");
    setAdded("");
  }, [removedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueRemoved = removed ? removed.current_count * removed.value : 0;
  const targetVal = target?.value ?? 0;
  const suggested = targetVal > 0 ? Math.round(valueRemoved / targetVal) : 0;
  // pre-fill suggested when target picked and field empty
  useEffect(() => { if (removed && target && added === "") setAdded(String(suggested)); }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addedN = Number(added) || 0;
  const valueAdded = addedN * targetVal;
  const rounding = valueRemoved - valueAdded;
  const withinTol = targetVal > 0 && Math.abs(rounding) < targetVal && !!removed && removed.current_count > 0;
  const step = !removed || !target ? 0 : !withinTol ? 1 : 2;

  const confirm = async () => {
    if (!removed || !target || !withinTol) return;
    setBusy(true);
    const r = await callRpc("chip_ops_color_up", {
      p_tournament_id: tournamentId, p_denom_removed: removedId, p_denom_target: targetId,
      p_target_added: addedN, p_level_number: currentLevel, p_idempotency_key: crypto.randomUUID(),
    });
    if (r?.status === "ok") {
      toast.success(`Đã color-up: rút ${fmt(Number(r.removed_count))} chip T${fmt(removed.value)} → ${fmt(addedN)} chip T${fmt(target.value)}.`);
      setRemovedId(""); setTargetId(""); setAdded(""); reload();
    }
    setBusy(false);
  };
  const reverse = async (opId: string) => {
    setBusy(true);
    const r = await callRpc("chip_ops_reverse_color_up", { p_operation_id: opId, p_idempotency_key: crypto.randomUUID() });
    if (r?.status === "ok") { toast.success("Đã hoàn tác color-up."); reload(); }
    setBusy(false);
  };

  if (!tournamentId || !clubId) {
    return <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">Chọn một giải để color-up.</CardContent></Card>;
  }
  if (loading) {
    return <Card className="border-border"><CardContent className="space-y-3 py-6"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /></CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Color-Up / Chip race {currentLevel != null && <span className="text-sm text-muted-foreground">· Level {currentLevel}{bigBlind ? ` · BB ${fmt(bigBlind)}` : ""}</span>}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Stepper steps={["Chọn mệnh giá", "Nhập số chip race", "Xác nhận"]} current={step} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Rút mệnh giá</Label>
              <Select value={removedId} onValueChange={setRemovedId}>
                <SelectTrigger><SelectValue placeholder="Chọn mệnh giá rút" /></SelectTrigger>
                <SelectContent>
                  {sorted.map((d) => (
                    <SelectItem key={d.denomination_id} value={d.denomination_id} disabled={d.current_count <= 0}>
                      T{fmt(d.value)} · còn {fmt(d.current_count)}
                      {bigBlind != null && d.value < bigBlind ? " · đến hạn" : ""}
                      {confirmedValues.has(d.value) && d.current_count > 0 ? " · đã color-up (chip mới)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Race lên</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger><SelectValue placeholder="Chọn mệnh giá nhận" /></SelectTrigger>
                <SelectContent>
                  {sorted.filter((d) => !removed || d.value > removed.value).map((d) => (
                    <SelectItem key={d.denomination_id} value={d.denomination_id}>T{fmt(d.value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {removed && target && (
            <>
              <div className="flex items-center justify-center gap-4 rounded-lg border border-border bg-secondary/40 p-4">
                <div className="flex flex-col items-center gap-1">
                  <ChipDisc value={removed.value} color={removed.color} size={48} />
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(removed.current_count)} → <span className="text-foreground">0</span></div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col items-center gap-1">
                  <ChipDisc value={target.value} color={target.color} size={48} />
                  <div className="text-xs tabular-nums text-muted-foreground">{fmt(target.current_count)} → <span className="text-foreground">{fmt(target.current_count + addedN)}</span></div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">Giá trị rút: <b className="tabular-nums text-foreground">{fmt(valueRemoved)}</b></div>

              <div>
                <Label className="text-xs">Số chip T{fmt(target.value)} race ra (gợi ý {fmt(suggested)})</Label>
                <div className="flex items-center gap-3">
                  <Input type="number" inputMode="numeric" value={added} onChange={(e) => setAdded(e.target.value)} className="w-32" />
                  <span className={`text-sm ${rounding === 0 ? "text-primary" : withinTol ? "text-warning" : "text-destructive"}`}>
                    {rounding === 0 ? "khớp ✓" : withinTol ? `dư ${fmt(Math.abs(rounding))} — trao 1 chip cho high card` : "sai số lớn ✗"}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={confirm} disabled={busy || !withinTol}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Xác nhận color-up
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Lịch sử color-up</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có color-up nào.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Level</TableHead><TableHead>Rút → Nhận</TableHead><TableHead className="text-right">Số rút</TableHead>
                <TableHead className="text-right">Race ra</TableHead><TableHead className="text-right">Dư</TableHead><TableHead className="text-right">Hoàn tác</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id} className={h.status === "reversed" ? "opacity-50" : ""}>
                    <TableCell className="tabular-nums">{h.level_number}</TableCell>
                    <TableCell className="tabular-nums">T{fmt(h.denom_removed_value)} → T{fmt(h.denom_target_value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(h.removed_count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(h.target_added)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(h.rounding_delta) === 0 ? "—" : fmt(Number(h.rounding_delta))}</TableCell>
                    <TableCell className="text-right">
                      {h.status === "reversed" ? <span className="text-xs text-muted-foreground">đã hoàn tác</span> : (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => reverse(h.id)}><Undo2 className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
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
