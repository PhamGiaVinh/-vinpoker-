/**
 * FeatureTableManageDialog — the FULL feature/final CONFIG surface, lifted OUT of the
 * always-on right-rail box (Dealer Swing UI declutter, 2026-07-02). Lists EVERY table
 * with a mode filter + a per-table row that opens FeatureTableConfigDialog. The rail now
 * shows only a lean special-tables summary (FeatureTablePoolBox); this heavy per-table
 * config is opened on demand from that box's "Cấu hình…" button.
 *
 * NO logic/RPC change vs the old inline list — same store (getProfile/matchesFilter),
 * same FeatureTableConfigDialog, same poolDealers derivation. Only WHERE it renders moved
 * (from an always-on card to an on-demand dialog).
 */
import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FeatureTableBadge } from "./FeatureTableBadge";
import { FeatureTableConfigDialog, type PoolDealer } from "./FeatureTableConfigDialog";
import { getProfile, matchesFilter, useFeatureTableVersion, type FeatureFilter } from "./featureTableMock";

const FILTERS: { key: FeatureFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "normal", label: "Thường" },
  { key: "feature", label: "Tâm điểm" },
  { key: "final", label: "Final" },
];

export function FeatureTableManageDialog({
  open, onOpenChange, clubId, tables, dealers,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clubId: string;
  tables: any[];
  dealers: any[];
}) {
  const ver = useFeatureTableVersion();
  const [filter, setFilter] = useState<FeatureFilter>("all");
  const [cfg, setCfg] = useState<{ tableId: string; tableName: string } | null>(null);

  // dealers in shift → {id,name} for the pool picker (same derivation as the old box)
  const poolDealers: PoolDealer[] = useMemo(() => {
    const seen = new Set<string>();
    const out: PoolDealer[] = [];
    for (const d of dealers ?? []) {
      // dealer_attendance row: dealer_id IS the dealers.id FK (inner dealers join has no id)
      const id = d?.dealer_id;
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, name: d?.dealers?.full_name ?? "—" }); }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [dealers]);

  const counts = useMemo(() => {
    let normal = 0, feature = 0, final = 0;
    for (const t of tables ?? []) {
      const p = getProfile(t.id);
      if (p.isFinal) final++;
      else if (p.tableMode === "feature") feature++;
      else normal++;
    }
    return { normal, feature, final };
  }, [tables, ver]);

  const shown = (tables ?? []).filter((t) => matchesFilter(getProfile(t.id), filter));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cấu hình bàn tâm điểm / Final</DialogTitle>
          <DialogDescription>
            Chọn một bàn để đặt làm Tâm điểm/Final và gán nhóm dealer được phép xoay vòng.
          </DialogDescription>
        </DialogHeader>

        {/* counts */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[["Thường", counts.normal, "text-foreground"], ["Tâm điểm", counts.feature, "text-success"], ["Final", counts.final, "text-amber-400"]].map(
            ([label, n, c]) => (
              <div key={label as string} className="rounded-md border border-border bg-muted/30 py-1">
                <div className={cn("font-mono text-sm font-bold", c as string)}>{n as number}</div>
                <div className="text-[10px] text-muted-foreground">{label as string}</div>
              </div>
            ),
          )}
        </div>

        {/* filter */}
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                filter === f.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* table list — full, on-demand */}
        <div className="max-h-[50vh] space-y-1 overflow-auto">
          {shown.length === 0 && (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">Không có bàn phù hợp</div>
          )}
          {shown.map((t) => (
            <button
              key={t.id}
              onClick={() => setCfg({ tableId: t.id, tableName: t.table_name ?? "Bàn" })}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 p-2 text-left transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{t.table_name}</span>
              <FeatureTableBadge tableId={t.id} />
              <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>

        {cfg && (
          <FeatureTableConfigDialog
            open={!!cfg}
            onOpenChange={(o) => { if (!o) setCfg(null); }}
            tableId={cfg.tableId}
            tableName={cfg.tableName}
            clubId={clubId}
            dealers={poolDealers}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
