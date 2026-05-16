import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { saveCustomRange } from "@/lib/gto/precomputed";
import type { Range } from "@/lib/gto/rangeTree";
import { History, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

type HistoryRow = {
  id: string;
  spot_key: string;
  range: Range;
  previous_range: Range | null;
  changed_by: string | null;
  change_type: string;
  note: string | null;
  created_at: string;
  changer_name?: string | null;
};

function diffHands(prev: Range | null, next: Range): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const dominant = (h: any) => {
    if (!h) return "fold";
    const e = Object.entries(h) as [string, number][];
    e.sort((a, b) => b[1] - a[1]);
    return e[0]?.[0] ?? "fold";
  };
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  for (const k of keys) {
    const a = prev?.[k];
    const b = next[k];
    const da = dominant(a);
    const db = dominant(b);
    if (!a && b && db !== "fold") added.push(k);
    else if (a && (!b || db === "fold") && da !== "fold") removed.push(k);
    else if (da !== db) changed.push(k);
  }
  return { added, removed, changed };
}

export default function RangeHistoryPanel({ spotKey }: { spotKey: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("gto_spot_range_history")
      .select("*")
      .eq("spot_key", spotKey)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Lỗi tải lịch sử", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.changed_by).filter(Boolean)));
    let names = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      profiles?.forEach((p: any) => names.set(p.user_id, p.display_name ?? "—"));
    }
    setRows((data ?? []).map((r: any) => ({ ...r, changer_name: r.changed_by ? names.get(r.changed_by) ?? "—" : "system" })));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`gto_history_${spotKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gto_spot_range_history", filter: `spot_key=eq.${spotKey}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey]);

  const handleRollback = async (row: HistoryRow) => {
    if (!confirm(`Rollback ${spotKey} về phiên bản lúc ${new Date(row.created_at).toLocaleString("vi-VN")}?`)) return;
    setBusy(row.id);
    try {
      // Rollback target = the range stored in this row (post-change snapshot)
      await saveCustomRange(spotKey as any, row.range);
      toast({ title: "Đã rollback", description: spotKey });
    } catch (err: any) {
      toast({ title: "Rollback thất bại", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <History className="w-4 h-4" />
        Lịch sử thay đổi
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">{spotKey}</Badge>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Chưa có thay đổi nào.</div>
      ) : (
        <div className="space-y-1 max-h-[420px] overflow-y-auto">
          {rows.map((row, idx) => {
            const isExp = expanded === row.id;
            const diff = diffHands(row.previous_range, row.range);
            const isLatest = idx === 0;
            return (
              <div key={row.id} className="border border-border/40 rounded">
                <button
                  className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 text-xs"
                  onClick={() => setExpanded(isExp ? null : row.id)}
                >
                  {isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <Badge variant={row.change_type === "rollback" ? "default" : "secondary"} className="text-[10px] h-5">
                    {row.change_type}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(row.created_at).toLocaleString("vi-VN", { hour12: false })}
                  </span>
                  <span className="ml-auto text-muted-foreground truncate max-w-[120px]">
                    {row.changer_name}
                  </span>
                  {isLatest && <Badge variant="outline" className="text-[9px] h-4">current</Badge>}
                </button>
                {isExp && (
                  <div className="p-2 border-t border-border/40 space-y-2 text-[11px]">
                    <div className="flex flex-wrap gap-3">
                      <span className="text-green-500">+ {diff.added.length} thêm</span>
                      <span className="text-red-500">− {diff.removed.length} bỏ</span>
                      <span className="text-yellow-500">~ {diff.changed.length} đổi action</span>
                    </div>
                    {diff.added.length > 0 && (
                      <div><span className="text-green-500">Thêm:</span> <span className="font-mono">{diff.added.slice(0, 30).join(", ")}{diff.added.length > 30 ? "…" : ""}</span></div>
                    )}
                    {diff.removed.length > 0 && (
                      <div><span className="text-red-500">Bỏ:</span> <span className="font-mono">{diff.removed.slice(0, 30).join(", ")}{diff.removed.length > 30 ? "…" : ""}</span></div>
                    )}
                    {diff.changed.length > 0 && (
                      <div><span className="text-yellow-500">Đổi:</span> <span className="font-mono">{diff.changed.slice(0, 30).join(", ")}{diff.changed.length > 30 ? "…" : ""}</span></div>
                    )}
                    {!isLatest && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={busy === row.id}
                        onClick={() => handleRollback(row)}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        {busy === row.id ? "Đang rollback…" : "Rollback về phiên bản này"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
