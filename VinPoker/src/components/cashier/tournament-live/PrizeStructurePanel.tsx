import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Save, Plus, Trash2 } from "lucide-react";

interface PrizeRow {
  position: number;
  percentage: number;
  amount: number;
}

export function PrizeStructurePanel({ tournamentId }: { tournamentId: string }) {
  const [rows, setRows] = useState<PrizeRow[]>([{ position: 1, percentage: 40, amount: 0 }]);
  const [loading, setLoading] = useState(false);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { position: prev.length + 1, percentage: 0, amount: 0 },
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

  const handleSave = async () => {
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
      if (error || data?.error) { toast.error(data?.error || error?.message); return; }
      toast.success("Đã lưu prize structure");
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Prize Structure</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Thêm
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            <Save className="w-3.5 h-3.5 mr-1" />
            Lưu
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-4 gap-2 items-center border rounded p-2">
            <Input type="number" placeholder="Position" value={row.position} onChange={(e) => updateRow(i, "position", Number(e.target.value))} />
            <Input type="number" placeholder="%" value={row.percentage} onChange={(e) => updateRow(i, "percentage", Number(e.target.value))} />
            <Input type="number" placeholder="Amount" value={row.amount} onChange={(e) => updateRow(i, "amount", Number(e.target.value))} />
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeRow(i)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
