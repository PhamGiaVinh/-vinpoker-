// "Diễn biến giải" tournament-wide story feed (Viewer Event Hub — #4). Presentational
// only — rows derived from already-loaded hand_players + tournament meta. Shows
// CERTAIN tournament events: eliminations, players-remaining milestones, final table.
// Never names a killer/winner (the DB stores neither). Theme-aware via semantic
// tokens; localized via i18n with vi inline defaults. Collapses to nothing when empty.

import { useTranslation } from "react-i18next";
import { UserMinus, Users, Trophy, type LucideIcon } from "lucide-react";
import type { HubStoryItem, HubStoryKind } from "./hubDerive";

export interface LiveStoryFeedProps {
  items: HubStoryItem[];
}

const KIND_META: Record<HubStoryKind, { cls: string; Icon: LucideIcon }> = {
  elimination: { cls: "bg-destructive/15 text-destructive border-destructive/40", Icon: UserMinus },
  milestone: { cls: "bg-warning/15 text-warning border-warning/40", Icon: Users },
  final_table: { cls: "bg-success/15 text-success border-success/40", Icon: Trophy },
};

export function LiveStoryFeed({ items }: LiveStoryFeedProps) {
  const { t } = useTranslation();
  if (!items || items.length === 0) return null;

  const labelFor = (it: HubStoryItem): string => {
    if (it.kind === "elimination") {
      return it.count != null
        ? t("liveHub.story.eliminated", "{{name}} bị loại — còn {{count}} người", { name: it.name, count: it.count })
        : t("liveHub.story.eliminatedNoCount", "{{name}} bị loại", { name: it.name });
    }
    if (it.kind === "final_table") {
      return it.count != null
        ? t("liveHub.story.finalTable", "Final table — còn {{count}} người", { count: it.count })
        : t("liveHub.story.finalTableNoCount", "Final table");
    }
    return t("liveHub.story.remaining", "Còn {{count}} người", { count: it.count }); // milestone
  };

  return (
    <div className="space-y-1.5">
      <div className="tracker-display flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("liveHub.story.title", "Diễn biến giải")}
      </div>
      <div className="rounded-xl border border-border/50 bg-card/50 divide-y divide-border/30 overflow-hidden shadow-[0_0_18px_rgba(0,0,0,0.25)]">
        {items.map((it) => {
          const meta = KIND_META[it.kind] || KIND_META.milestone;
          const Icon = meta.Icon;
          return (
            <div key={it.id} className="grid grid-cols-[34px_1fr] items-center gap-2.5 px-3 py-2.5">
              <span className={`grid h-[34px] w-[34px] place-items-center rounded-lg border ${meta.cls}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 text-xs">
                <span className="truncate font-medium text-foreground">{labelFor(it)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
