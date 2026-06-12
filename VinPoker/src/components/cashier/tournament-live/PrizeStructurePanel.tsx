import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Save, Plus, Trash2 } from "lucide-react";
import { formatVND } from "@/lib/format";

interface PrizeRow {
  position: number;
  percentage: number;
  amount: number;
}

const PERCENT_TOLERANCE = 0.01;

/**
 * Validates the draft before save. Returns null when valid, otherwise a
 * Vietnamese error naming the offending row/rank so the floor can fix it fast.
 */
function validatePrizes(rows: PrizeRow[]): string | null {
  if (rows.length === 0) return "Chưa có hạng giải nào để lưu.";
  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isFinite(r.position) || r.position < 1)
      return `Dòng ${i + 1}: hạng (position) phải ≥ 1.`;
    if (seen.has(r.position)) return `Hạng ${r.position} bị trùng.`;
    seen.add(r.position);
    if (!Number.isFinite(r.percentage) || r.percentage < 0)
      return `Hạng ${r.position}: % không được âm.`;
    if (!Number.isFinite(r.amount) || r.amount < 0)
      return `Hạng ${r.position}: tiền thưởng không được âm.`;
    if (r.percentage === 0 && r.amount === 0)
      return `Hạng ${r.position}: dòng rỗng (cả % và tiền đều bằng 0) — nhập giá trị hoặc xoá dòng.`;
  }
  const total = rows.reduce((s, r) => s + r.percentage, 0);
  if (Math.abs(total - 100) >= PERCENT_TOLERANCE)
    return `Tổng % hiện là ${total.toFixed(2)}% — phải bằng 100%.`;
  return null;
}

export function PrizeStructurePanel({ tournamentId }: { tournamentId: string }) {
  const [rows, setRows] = useState<PrizeRow[]>([{ position: 1, percentage: 100, amount: 0 }]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  // Load existing structure BEFORE allowing any save — Save while stale local
  // state would silently wipe the live structure back to the default row.
  const loadPrizes = useCallback(async () => {
    setInitialLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_tournament_prizes", {
        p_tournament_id: tournamentId,
      });
      let list: any[] | null = null;
      if (!error) {
        const d = data as any;
        if (Array.isArray(d)) list = d;
        else if (Array.isArray(d?.data)) list = d.data;
      }
      if (list == null) {
        // Read-only load fallback only — saves still go through update_tournament_prizes.
        const { data: direct, error: directErr } = await supabase
          .from("tournament_prizes")
          .select("position, percentage, amount")
          .eq("tournament_id", tournamentId)
          .order("position");
        if (directErr) {
          toast.error("Không tải được cơ cấu giải hiện tại: " + directErr.message);
          return;
        }
        list = direct ?? [];
      }
      if (list.length > 0) {
        setRows(
          list
            .map((r: any) => ({
              position: Number(r.position),
              percentage: Number(r.percentage),
              amount: Number(r.amount),
            }))
            .sort((a, b) => a.position - b.position),
        );
      }
    } finally {
      setInitialLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadPrizes();
  }, [loadPrizes]);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { position: (prev.length ? Math.max(...prev.map((r) => r.position)) : 0) + 1, percentage: 0, amount: 0 },
    ]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof PrizeRow, value: number) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const totalPercent = rows.reduce((s, r) => s + r.percentage, 0);
  const percentOk = Math.abs(totalPercent - 100) < PERCENT_TOLERANCE;

  const handleSave = async () => {
    const validationError = validatePrizes(rows);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("update_tournament_prizes", {
        p_tournament_id: tournamentId,
        p_prizes: rows.map((r) => ({
          position: r.position,
          percentage: r.percentage,
          amount: r.amount,
        })),
      });
      const result = data as any;
      if (error || result?.error) { toast.error(result?.error || error?.message); return; }
      toast.success("Đã lưu cơ cấu giải thưởng");
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">Cơ cấu giải thưởng dự kiến</div>
          <p className="text-xs text-muted-foreground">
            Cơ cấu % dự kiến — không phải số tiền đã chi trả.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={percentOk ? "text-success border-success/40" : "text-destructive border-destructive/40"}
          >
            Σ {totalPercent.toFixed(2)}%
          </Badge>
          <Button size="sm" variant="outline" onClick={addRow} disabled={initialLoading}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Thêm
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading || initialLoading || !percentOk}>
            <Save className="w-3.5 h-3.5 mr-1" />
            Lưu
          </Button>
        </div>
      </div>

      {initialLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 px-2 text-xs text-muted-foreground">
            <span>Hạng</span>
            <span>%</span>
            <span>Tiền thưởng</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-center border rounded p-2">
              <Input type="number" min={1} placeholder="Hạng" value={row.position} onChange={(e) => updateRow(i, "position", Number(e.target.value))} />
              <Input type="number" min={0} placeholder="%" value={row.percentage} onChange={(e) => updateRow(i, "percentage", Number(e.target.value))} />
              <div className="space-y-0.5">
                <Input type="number" min={0} placeholder="Số tiền" value={row.amount} onChange={(e) => updateRow(i, "amount", Number(e.target.value))} />
                {row.amount > 0 && (
                  <div className="text-[11px] text-muted-foreground font-mono pl-1">{formatVND(row.amount)}</div>
                )}
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeRow(i)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
