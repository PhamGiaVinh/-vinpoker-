import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PackagePlus } from "lucide-react";

const REASON_VI: Record<string, string> = {
  stock_in: "Nhập kho", sale: "Bán", cancel_return: "Hoàn (huỷ)", stocktake_adjust: "Kiểm kho", manual: "Thủ công",
};

type Movement = {
  id: string; ingredient_id: string; delta: number; reason: string;
  unit_cost: number | null; balance_after: number | null; created_at: string;
};

export function StockInForm({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const { data } = useFnbMenu(clubId);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);
  const ingName = (id: string) => (data?.ingredients ?? []).find((i) => i.id === id)?.name ?? "—";

  const [ingredientId, setIngredientId] = useState<string>("");
  const [qtyPurchase, setQtyPurchase] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState<Movement[] | null>(null);

  const loadMovements = useCallback(async () => {
    if (!clubId) return;
    const { data: rows } = await (supabase as any)
      .from("fnb_stock_movements").select("*").eq("club_id", clubId)
      .order("created_at", { ascending: false }).limit(12);
    setMovements((rows ?? []) as Movement[]);
  }, [clubId]);

  useEffect(() => { loadMovements(); }, [loadMovements]);

  const selected = ingredients.find((i) => i.id === ingredientId);

  const submit = async () => {
    if (!ingredientId) { toast.error("Chọn nguyên liệu."); return; }
    const qty = Number(qtyPurchase);
    const cost = Number(unitCost);
    if (!(qty > 0)) { toast.error("Số lượng mua phải lớn hơn 0."); return; }
    if (!(cost >= 0)) { toast.error("Giá mua không hợp lệ."); return; }
    setSaving(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_stock_in", {
      p_club_id: clubId,
      p_ingredient_id: ingredientId,
      p_qty_purchase: qty,
      p_unit_cost_purchase: cost,
      p_client_request_id: crypto.randomUUID(),
    });
    setSaving(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    // fnb_stock_in idempotent fast-path returns {idempotent:true} with NO on_hand/avg_unit_cost — a
    // double-submit would otherwise toast "Tồn mới: undefined". Show a distinct (success) message.
    if (res?.idempotent) {
      toast.success("Lệnh nhập kho này đã được ghi trước đó — không nhập trùng.");
    } else {
      toast.success(`Đã nhập kho. Tồn mới: ${res.on_hand} · Giá vốn TB: ${formatVND(Math.round(res.avg_unit_cost ?? 0))}`);
    }
    setQtyPurchase("");
    setUnitCost("");
    qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
    loadMovements();
  };

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-base">Nhập kho</h3>
        <p className="text-xs text-muted-foreground">Nhập theo đơn vị mua; hệ thống tự quy đổi &amp; tính giá vốn bình quân.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Nguyên liệu</Label>
          <Select value={ingredientId} onValueChange={setIngredientId}>
            <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Chọn nguyên liệu" /></SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="si-qty">Số lượng mua{selected?.purchase_unit ? ` (${selected.purchase_unit})` : selected ? ` (${selected.stock_unit})` : ""}</Label>
          <Input id="si-qty" type="number" step="any" value={qtyPurchase}
            onChange={(e) => setQtyPurchase(e.target.value)} className="bg-card border-border text-foreground" />
        </div>
        <div>
          <Label htmlFor="si-cost">Giá 1 đơn vị mua (₫)</Label>
          <Input id="si-cost" type="number" step="any" value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)} className="bg-card border-border text-foreground text-right font-mono" />
        </div>
      </div>

      {selected && selected.purchase_unit && Number(qtyPurchase) > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          = {Number(qtyPurchase) * selected.units_per_purchase} {selected.stock_unit} vào kho.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving || !ingredientId}
          className="bg-success hover:bg-success/90 text-success-foreground">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <PackagePlus className="w-4 h-4 mr-1" />}
          Nhập kho
        </Button>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Lịch sử kho gần đây</div>
        {movements === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải…</div>
        ) : movements.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/20 py-6 text-center text-sm text-muted-foreground">Chưa có chuyển động kho.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nguyên liệu</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead className="text-right">Thay đổi</TableHead>
                  <TableHead className="text-right">Tồn sau</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{ingName(m.ingredient_id)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{REASON_VI[m.reason] ?? m.reason}</TableCell>
                    <TableCell className={`text-right font-mono ${m.delta >= 0 ? "text-success" : "text-destructive"}`}>
                      {m.delta >= 0 ? "+" : ""}{m.delta}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{m.balance_after ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}
