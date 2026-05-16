import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { Loader2, Plus, Save, Trash2, AlertTriangle } from "lucide-react";

type FeeTier = {
  id: string;
  min_buy_in: number;
  max_buy_in: number;
  fixed_fee: number;
  percent_fee: number;
  is_active: boolean;
};

export default function FeeConfigManager() {
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<FeeTier>>>({});
  const [adding, setAdding] = useState(false);
  const [newTier, setNewTier] = useState({ min_buy_in: 0, max_buy_in: 0, fixed_fee: 0, percent_fee: 1.0 });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_fee_config")
      .select("*")
      .order("min_buy_in", { ascending: true });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setTiers((data ?? []) as FeeTier[]);
    setEdits({});
  }, []);

  useEffect(() => { load(); }, [load]);

  const setEdit = (id: string, patch: Partial<FeeTier>) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  };

  const saveTier = async (tier: FeeTier) => {
    const patch = edits[tier.id];
    if (!patch) return;
    setSaving(tier.id);
    const { error } = await supabase
      .from("platform_fee_config")
      .update({
        ...(patch.fixed_fee != null && { fixed_fee: Math.floor(Number(patch.fixed_fee)) }),
        ...(patch.percent_fee != null && { percent_fee: Number(patch.percent_fee) }),
        ...(patch.min_buy_in != null && { min_buy_in: Math.floor(Number(patch.min_buy_in)) }),
        ...(patch.max_buy_in != null && { max_buy_in: Math.floor(Number(patch.max_buy_in)) }),
      })
      .eq("id", tier.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã lưu");
    load();
  };

  const toggleActive = async (tier: FeeTier, value: boolean) => {
    const { error } = await supabase
      .from("platform_fee_config")
      .update({ is_active: value })
      .eq("id", tier.id);
    if (error) { toast.error(error.message); return; }
    setTiers((t) => t.map((x) => (x.id === tier.id ? { ...x, is_active: value } : x)));
  };

  const removeTier = async (tier: FeeTier) => {
    if (!confirm(`Xóa tier ${formatVND(tier.min_buy_in)} - ${formatVND(tier.max_buy_in)}?`)) return;
    const { error } = await supabase.from("platform_fee_config").delete().eq("id", tier.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã xóa");
    load();
  };

  const addTier = async () => {
    if (newTier.max_buy_in <= newTier.min_buy_in) {
      toast.error("Max phải lớn hơn Min");
      return;
    }
    if (newTier.fixed_fee < 0) { toast.error("Phí cố định phải >= 0"); return; }
    const { error } = await supabase.from("platform_fee_config").insert({
      min_buy_in: Math.floor(newTier.min_buy_in),
      max_buy_in: Math.floor(newTier.max_buy_in),
      fixed_fee: Math.floor(newTier.fixed_fee),
      percent_fee: Number(newTier.percent_fee),
      is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Đã thêm tier mới");
    setAdding(false);
    setNewTier({ min_buy_in: 0, max_buy_in: 0, fixed_fee: 0, percent_fee: 1.0 });
    load();
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Cấu hình phí dịch vụ</h3>
          <p className="text-xs text-muted-foreground">Phí cố định Player trả tại quầy + Phí % trên giải thưởng (mặc định 1%).</p>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="w-4 h-4 mr-1" /> Thêm tier
        </Button>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2 text-xs text-warning">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Thay đổi chỉ áp dụng cho deal tạo mới. Deal hiện tại giữ phí được snapshot khi tạo.</span>
      </div>

      {adding && (
        <Card className="p-3 border-primary/30 bg-primary/5 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Min buy-in (₫)</label>
              <Input type="number" value={newTier.min_buy_in}
                onChange={(e) => setNewTier((t) => ({ ...t, min_buy_in: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Max buy-in (₫)</label>
              <Input type="number" value={newTier.max_buy_in}
                onChange={(e) => setNewTier((t) => ({ ...t, max_buy_in: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Phí cố định (₫)</label>
              <Input type="number" value={newTier.fixed_fee}
                onChange={(e) => setNewTier((t) => ({ ...t, fixed_fee: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Phí % giải</label>
              <Input type="number" step="0.1" value={newTier.percent_fee}
                onChange={(e) => setNewTier((t) => ({ ...t, percent_fee: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={addTier}>Thêm</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Hủy</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải...</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phân khúc Buy-in</TableHead>
                <TableHead className="text-right">Phí cố định (₫)</TableHead>
                <TableHead className="text-right">Phí % giải</TableHead>
                <TableHead className="text-center">Trạng thái</TableHead>
                <TableHead className="text-right">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier) => {
                const e = edits[tier.id] ?? {};
                const dirty = Object.keys(e).length > 0;
                return (
                  <TableRow key={tier.id}>
                    <TableCell className="font-mono text-xs">
                      {formatVND(tier.min_buy_in)} → {formatVND(tier.max_buy_in)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="w-32 ml-auto text-right font-mono"
                        defaultValue={tier.fixed_fee}
                        onChange={(ev) => setEdit(tier.id, { fixed_fee: Number(ev.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.1"
                        className="w-20 ml-auto text-right font-mono"
                        defaultValue={tier.percent_fee}
                        onChange={(ev) => setEdit(tier.id, { percent_fee: Number(ev.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={tier.is_active} onCheckedChange={(v) => toggleActive(tier, v)} />
                      {!tier.is_active && <Badge variant="outline" className="ml-2 text-[10px]">tắt</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {dirty && (
                          <Button size="sm" disabled={saving === tier.id} onClick={() => saveTier(tier)}>
                            {saving === tier.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => removeTier(tier)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
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
