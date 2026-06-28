import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbMenu, type FnbMenuItem, type FnbCategory } from "@/hooks/useFnbMenu";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil } from "lucide-react";

const NO_CATEGORY = "__none__";

export function MenuManager({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useFnbMenu(clubId);
  const [editing, setEditing] = useState<FnbMenuItem | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["fnb", "menu", clubId] });
  const items = data?.items ?? [];
  const categories = data?.categories ?? [];
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Thực đơn</h3>
          <p className="text-xs text-muted-foreground">Giá ở đây là giá bán; sửa giá không làm thay đổi đơn đã thanh toán.</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Thêm món
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Chưa có món nào. Bấm “Thêm món” để tạo thực đơn.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Món</TableHead>
                <TableHead>Danh mục</TableHead>
                <TableHead className="text-right">Giá</TableHead>
                <TableHead className="text-center w-28">Trạng thái</TableHead>
                <TableHead className="text-right w-16">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-muted-foreground">{catName(m.category_id)}</TableCell>
                  <TableCell className="text-right font-mono">{formatVND(m.price_vnd)}</TableCell>
                  <TableCell className="text-center">
                    {m.is_active
                      ? <Badge variant="outline" className="text-[10px] border-success/40 text-success">Đang bán</Badge>
                      : <Badge variant="outline" className="text-[10px] text-muted-foreground">Tắt</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MenuItemDialog
        clubId={clubId} open={open} onOpenChange={setOpen}
        editing={editing} categories={categories} onSaved={refresh}
      />
    </Card>
  );
}

function MenuItemDialog({
  clubId, open, onOpenChange, editing, categories, onSaved,
}: {
  clubId: string; open: boolean; onOpenChange: (v: boolean) => void;
  editing: FnbMenuItem | null; categories: FnbCategory[]; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [price, setPrice] = useState("0");
  const [imageUrl, setImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const key = `${open}:${editing?.id ?? "new"}`;
  const [syncedKey, setSyncedKey] = useState("");
  if (open && key !== syncedKey) {
    setSyncedKey(key);
    setName(editing?.name ?? "");
    setCategoryId(editing?.category_id ?? NO_CATEGORY);
    setPrice(String(editing?.price_vnd ?? 0));
    setImageUrl(editing?.image_url ?? "");
    setIsActive(editing?.is_active ?? true);
  }

  const save = async () => {
    if (!name.trim()) { toast.error("Vui lòng nhập tên món."); return; }
    const priceNum = Math.max(0, Math.floor(Number(price) || 0));
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("fnb_upsert_menu_item", {
      p_club_id: clubId,
      p_id: editing?.id ?? null,
      p_category_id: categoryId === NO_CATEGORY ? null : categoryId,
      p_name: name.trim(),
      p_price_vnd: priceNum,
      p_is_active: isActive,
      p_image_url: imageUrl.trim() || null,
      p_sort_order: editing?.sort_order ?? 0,
    });
    setSaving(false);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(editing ? "Đã cập nhật món." : "Đã thêm món.");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa món" : "Thêm món"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">Tên, danh mục và giá bán.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="mi-name">Tên món *</Label>
            <Input id="mi-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Cà phê sữa" className="bg-card border-border text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Danh mục</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value={NO_CATEGORY}>— Không —</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mi-price">Giá bán (₫) *</Label>
              <Input id="mi-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                className="bg-card border-border text-foreground text-right font-mono" />
            </div>
          </div>
          <div>
            <Label htmlFor="mi-img">Ảnh (URL, không bắt buộc)</Label>
            <Input id="mi-img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…" className="bg-card border-border text-foreground" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <Label htmlFor="mi-active" className="cursor-pointer">Đang bán</Label>
            <Switch id="mi-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-foreground">Hủy</Button>
            <Button onClick={save} disabled={saving || !name.trim()}
              className="bg-success hover:bg-success/90 text-success-foreground">
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
