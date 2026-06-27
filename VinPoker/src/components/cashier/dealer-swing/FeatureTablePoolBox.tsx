/**
 * FeatureTablePoolBox — Patch 1 (UI mock). Right-rail "Đội dealer tâm điểm" box
 * for the Dealer Swing operator panel: per-mode counts, a mode filter, and a
 * per-table list with a "Cấu hình" entry to the config dialog + a pool preview
 * (member names, primary star, live availability from the in-shift dealers).
 * Mock/local store only (no DB/RPC). Rendered only when FEATURES.dealerFeatureTables.
 */
import { useMemo, useState } from "react";
import { Settings2, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FeatureTableBadge } from "./FeatureTableBadge";
import { FeatureTableConfigDialog, type PoolDealer } from "./FeatureTableConfigDialog";
import {
  getProfile, isSpecial, matchesFilter, useFeatureTableVersion,
  useFeatureTableRules, useFeatureEnforcementEnabled,
  type FeatureFilter,
} from "./featureTableMock";

const FILTERS: { key: FeatureFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "normal", label: "Thường" },
  { key: "feature", label: "Tâm điểm" },
  { key: "final", label: "Final" },
];

export function FeatureTablePoolBox({ clubId, tables, dealers }: { clubId: string | null; tables: any[]; dealers: any[] }) {
  const ver = useFeatureTableVersion();
  const { loading, error, refetch } = useFeatureTableRules(clubId); // P1-B: reads via get_table_dealer_rules
  const { enabled: enforcementOn } = useFeatureEnforcementEnabled();
  const [filter, setFilter] = useState<FeatureFilter>("all");
  const [cfg, setCfg] = useState<{ tableId: string; tableName: string } | null>(null);

  // dealers in shift → {id,name} for the pool picker; + a state lookup for availability
  const poolDealers: PoolDealer[] = useMemo(() => {
    const seen = new Set<string>();
    const out: PoolDealer[] = [];
    for (const d of dealers ?? []) {
      const id = d?.dealers?.id;
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, name: d.dealers.full_name ?? "—" }); }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [dealers]);

  const stateByDealer = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dealers ?? []) { if (d?.dealers?.id) m.set(d.dealers.id, d.current_state ?? "available"); }
    return m;
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

  const availLabel = (st: string | undefined) =>
    st === "on_break" ? { t: "nghỉ", c: "text-[hsl(var(--ds-active))]" }
      : st === "assigned" ? { t: "đang chia", c: "text-muted-foreground" }
        : st ? { t: "sẵn sàng", c: "text-success" } : { t: "—", c: "text-muted-foreground/50" };

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold tracking-wide text-foreground">Đội dealer tâm điểm</span>
        {loading && <span className="text-[10px] text-muted-foreground">Đang tải…</span>}
      </div>

      {enforcementOn === false && (
        <div className="mb-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning">
          ℹ Cấu hình đã lưu nhưng <b>enforcement đang TẮT</b> — nhóm dealer chưa bảo vệ bàn (bật sau).
        </div>
      )}
      {error && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 truncate">Lỗi tải cấu hình: {error}</span>
          <button onClick={() => void refetch()} className="shrink-0 underline">Thử lại</button>
        </div>
      )}

      {/* counts */}
      <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
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
      <div className="mb-2 flex flex-wrap gap-1">
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

      {/* table list */}
      <div className="max-h-72 space-y-1 overflow-auto">
        {shown.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">Không có bàn phù hợp</div>
        )}
        {shown.map((t) => {
          const p = getProfile(t.id);
          return (
            <div key={t.id} className="rounded-md border border-border bg-muted/20 p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{t.table_name}</span>
                <FeatureTableBadge tableId={t.id} />
                <button
                  onClick={() => setCfg({ tableId: t.id, tableName: t.table_name ?? "Bàn" })}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Cấu hình bàn"
                  aria-label="Cấu hình bàn"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {isSpecial(p) && (
                <div className="mt-1 space-y-0.5">
                  {p.pool.length === 0 ? (
                    <div className="text-[11px] text-warning">⚠ Chưa có dealer — sẽ báo thiếu</div>
                  ) : p.pool.map((m) => {
                    const av = availLabel(stateByDealer.get(m.dealerId));
                    return (
                      <div key={m.dealerId} className="flex items-center gap-1.5 text-[11px]">
                        {m.isPrimary && <Star className="h-2.5 w-2.5 shrink-0 text-amber-400" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.name}</span>
                        <span className={cn("shrink-0", av.c)}>{av.t}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cfg && clubId && (
        <FeatureTableConfigDialog
          open={!!cfg}
          onOpenChange={(o) => { if (!o) setCfg(null); }}
          tableId={cfg.tableId}
          tableName={cfg.tableName}
          clubId={clubId}
          dealers={poolDealers}
        />
      )}
    </Card>
  );
}
