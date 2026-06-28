import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ClipboardCheck, Check } from "lucide-react";

export function StocktakeBoard({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const { data } = useFnbMenu(clubId);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Find the club's single open session (uq_fnb_stocktake_one_open guarantees ≤1) + its saved lines.
  const loadSession = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const sb = supabase as any;
    const { data: s } = await sb.from("fnb_stocktakes")
      .select("id").eq("club_id", clubId).eq("status", "open").limit(1).maybeSingle();
    if (!s?.id) { setSessionId(null); setCounted({}); setLoading(false); return; }
    setSessionId(s.id);
    const { data: lines } = await sb.from("fnb_stocktake_lines")
      .select("ingredient_id, counted_qty").eq("stocktake_id", s.id);
    const map: Record<string, string> = {};
    for (const l of (lines ?? []) as { ingredient_id: string; counted_qty: number }[]) {
      map[l.ingredient_id] = String(l.counted_qty);
    }
    setCounted(map);
    setLoading(false);
  }, [clubId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  const createSession = async () => {
    setBusy(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_open_stocktake", {
      p_club_id: clubId, p_note: null, p_client_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    setSessionId(res.stocktake_id);
    setCounted({});
  };

  // Save one counted line on blur (only when it's a valid, changed number).
  const saveLine = async (ingredientId: string, raw: string) => {
    if (!sessionId) return;
    const v = raw.trim();
    if (v === "") return;
    const qty = Number(v);
    if (!(qty >= 0)) { toast.error("Số đếm không hợp lệ."); return; }
    setSavingId(ingredientId);
    const { data: out, error } = await (supabase.rpc as any)("fnb_set_stocktake_line", {
      p_stocktake_id: sessionId, p_ingredient_id: ingredientId, p_counted_qty: qty,
    });
    setSavingId(null);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
  };

  const commit = async () => {
    if (!sessionId) return;
    if (!confirm("Chốt kiểm kho? Tồn kho sẽ được điều chỉnh theo số đã đếm.")) return;
    setBusy(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_commit_stocktake", { p_stocktake_id: sessionId });
    setBusy(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(`Đã chốt. Điều chỉnh ${res.adjusted_lines ?? 0} nguyên liệu.`);
    qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
    loadSession(); // session is now committed → board resets to "Tạo phiên"
  };

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải…</div>
      </Card>
    );
  }

  if (!sessionId) {
    return (
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">Kiểm kho</h3>
          <p className="text-xs text-muted-foreground">Đếm tồn thực tế → chốt để điều chỉnh sổ kho (hao hụt/vỡ/hỏng).</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">Chưa có phiên kiểm kho đang mở.</p>
          <Button onClick={createSession} disabled={busy} className="bg-success hover:bg-success/90 text-success-foreground">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
            Tạo phiên kiểm kho
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Kiểm kho · phiên đang mở</h3>
          <p className="text-xs text-muted-foreground">Nhập số đếm thực tế cho từng nguyên liệu, rồi “Chốt”.</p>
        </div>
        <Button onClick={commit} disabled={busy} className="bg-success hover:bg-success/90 text-success-foreground">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
          Chốt kiểm kho
        </Button>
      </div>

      {ingredients.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có nguyên liệu để kiểm.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguyên liệu</TableHead>
                <TableHead className="text-right">Sổ (hiện tại)</TableHead>
                <TableHead className="text-right w-32">Đếm thực tế</TableHead>
                <TableHead className="text-right w-24">Lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((i) => {
                const raw = counted[i.id];
                const hasCount = raw != null && raw.trim() !== "" && Number.isFinite(Number(raw));
                const delta = hasCount ? Number(raw) - i.on_hand : null;
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name} <span className="text-muted-foreground text-xs">({i.stock_unit})</span></TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{i.on_hand}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingId === i.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                        <Input type="number" step="any" inputMode="decimal"
                          className="w-24 bg-card border-border text-foreground text-right font-mono"
                          value={raw ?? ""}
                          onChange={(e) => setCounted((c) => ({ ...c, [i.id]: e.target.value }))}
                          onBlur={(e) => saveLine(i.id, e.target.value)} />
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${delta == null ? "text-muted-foreground" : delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive"}`}>
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
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
