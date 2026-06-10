import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload } from "lucide-react";

export function BlindStructurePanel({ tournamentId }: { tournamentId: string }) {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!csv.trim()) { toast.error("Dán nội dung CSV"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("import_blind_structure", {
        p_tournament_id: tournamentId,
        p_csv_data: csv.trim(),
      });
      const result = data as any;
      if (error || result?.error) { toast.error(result?.error || error?.message); return; }
      toast.success(`Đã import ${result?.levels_imported ?? 0} levels`);
      setCsv("");
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="font-semibold">Blind Structure Import</div>
      <div className="text-xs text-muted-foreground">
        Dán CSV theo format: <code>small_blind,big_blind,ante,duration_minutes,is_break</code>
        <br />
        VD: <code>100,200,0,20,false</code>
      </div>
      <Textarea
        placeholder="Dán CSV ở đây..."
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={10}
      />
      <Button size="sm" onClick={handleImport} disabled={loading}>
        <Upload className="w-3.5 h-3.5 mr-1" />
        {loading ? "Đang import..." : "Import"}
      </Button>
    </Card>
  );
}
