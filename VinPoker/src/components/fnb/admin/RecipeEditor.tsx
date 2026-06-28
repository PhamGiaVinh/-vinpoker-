import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Save, Info } from "lucide-react";

type Row = { ingredient_id: string; qty: string };

export function RecipeEditor({ clubId }: { clubId: string }) {
  const { data } = useFnbMenu(clubId);
  const items = (data?.items ?? []);
  const ingredients = (data?.ingredients ?? []).filter((i) => i.is_active);
  const ingName = (id: string) => (data?.ingredients ?? []).find((i) => i.id === id)?.name ?? "—";

  const [menuItemId, setMenuItemId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRecipe = useCallback(async (mid: string) => {
    if (!mid) { setRows([]); return; }
    setLoading(true);
    const { data: r } = await (supabase as any)
      .from("fnb_recipe_items").select("ingredient_id, qty").eq("menu_item_id", mid);
    setLoading(false);
    setRows(((r ?? []) as { ingredient_id: string; qty: number }[]).map((x) => ({
      ingredient_id: x.ingredient_id, qty: String(x.qty),
    })));
  }, []);

  useEffect(() => { loadRecipe(menuItemId); }, [menuItemId, loadRecipe]);

  const addRow = () => setRows((r) => [...r, { ingredient_id: "", qty: "" }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!menuItemId) { toast.error("Chọn món trước."); return; }
    const items: { ingredient_id: string; qty: number }[] = [];
    for (const row of rows) {
      if (!row.ingredient_id) { toast.error("Chọn nguyên liệu cho mọi dòng (hoặc xoá dòng trống)."); return; }
      const q = Number(row.qty);
      if (!(q > 0)) { toast.error(`Định mức của “${ingName(row.ingredient_id)}” phải lớn hơn 0.`); return; }
      items.push({ ingredient_id: row.ingredient_id, qty: q });
    }
    setSaving(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_set_recipe", {
      p_menu_item_id: menuItemId,
      p_items: items, // empty array clears the recipe
    });
    setSaving(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(`Đã lưu công thức (${items.length} nguyên liệu).`);
    loadRecipe(menuItemId);
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Công thức (định mức nguyên liệu)</h3>
        <p className="text-xs text-muted-foreground">Khai báo mỗi món dùng bao nhiêu nguyên liệu — để trừ kho &amp; tính giá vốn khi bán.</p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <span>Món <span className="font-medium">chưa có công thức</span> vẫn bán được nhưng giá vốn = 0 (không trừ kho).</span>
      </div>

      <div className="max-w-md">
        <Label>Chọn món</Label>
        <Select value={menuItemId} onValueChange={setMenuItemId}>
          <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Chọn món để sửa công thức" /></SelectTrigger>
          <SelectContent className="bg-card border-border text-foreground">
            {items.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!menuItemId ? null : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải công thức…</div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="rounded-lg border border-border bg-muted/20 py-6 text-center text-sm text-muted-foreground">
              Món này chưa có công thức. Bấm “Thêm nguyên liệu”.
            </div>
          )}
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={row.ingredient_id} onValueChange={(v) => setRow(i, { ingredient_id: v })}>
                  <SelectTrigger className="bg-card border-border text-foreground"><SelectValue placeholder="Nguyên liệu" /></SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    {ingredients.map((ing) => <SelectItem key={ing.id} value={ing.id}>{ing.name} ({ing.stock_unit})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Input type="number" step="any" value={row.qty} placeholder="Định mức"
                onChange={(e) => setRow(i, { qty: e.target.value })}
                className="w-28 bg-card border-border text-foreground text-right font-mono" />
              <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2">
            <Button size="sm" variant="outline" onClick={addRow} className="border-border text-foreground">
              <Plus className="w-4 h-4 mr-1" /> Thêm nguyên liệu
            </Button>
            <Button onClick={save} disabled={saving}
              className="bg-success hover:bg-success/90 text-success-foreground">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Lưu công thức
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
