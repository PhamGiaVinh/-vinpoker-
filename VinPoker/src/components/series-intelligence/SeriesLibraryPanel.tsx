import { useState } from "react";
import { Library, Pencil, X, Check, CalendarDays, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Series } from "@/lib/series-intelligence/seriesLibrary";

/** Sum of non-null total_entries across a series' events (count, not money). */
function totalEntries(s: Series): number {
  return s.events.reduce((acc, e) => acc + (e.total_entries ?? 0), 0);
}

/**
 * "Thư viện Series" — lists the loaded CSV series (browser-only). Pick the ACTIVE series to view
 * (the dashboard above runs on it), rename inline, remove one, or clear all. Renders nothing when
 * the library is empty (the CSV importer below guides the first upload).
 */
export function SeriesLibraryPanel({
  series,
  activeId,
  onSelect,
  onRename,
  onRemove,
  onClearAll,
}: {
  series: Series[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (series.length === 0) return null;

  const startEdit = (s: Series): void => {
    setEditingId(s.id);
    setDraft(s.name);
  };
  const commitEdit = (id: string): void => {
    const next = draft.trim();
    if (next !== "") onRename(id, next); // empty rejected (reducer also guards)
    setEditingId(null);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" /> Thư viện Series
          <span className="text-xs text-muted-foreground">({series.length})</span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            if (window.confirm(`Xóa tất cả ${series.length} series khỏi thư viện trên thiết bị này?`)) onClearAll();
          }}
        >
          Xóa tất cả
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {series.map((s) => {
          const isActive = s.id === activeId;
          const isEditing = s.id === editingId;
          return (
            <Card
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => !isEditing && onSelect(s.id)}
              onKeyDown={(e) => {
                if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
              className={cn(
                "p-3 gradient-card cursor-pointer transition-colors space-y-1",
                isActive ? "border-primary ring-1 ring-primary/40" : "border-primary/30 hover:border-primary/50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(s.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => commitEdit(s.id)}
                      className="h-7 text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Lưu tên"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitEdit(s.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-sm font-medium truncate">{s.name}</span>
                    {isActive && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-primary">
                        <Eye className="h-3 w-3" /> Đang xem
                      </span>
                    )}
                  </div>
                )}
                {!isEditing && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      aria-label="Đổi tên"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(s);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label="Xóa series"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(s.id);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {s.seriesDate ?? "—"}
                </span>
                <span>{s.events.length} sự kiện</span>
                <span>{totalEntries(s).toLocaleString("vi-VN")} entry</span>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
