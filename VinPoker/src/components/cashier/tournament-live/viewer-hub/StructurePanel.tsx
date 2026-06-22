// Public "Cấu trúc" (blind structure) tab — READ-ONLY level ladder for the
// spectator event view. Reads tournament_levels (anon-readable) ordered by level.
// Break rows are styled apart; the live level is highlighted when known. No
// operator-editor coupling, no writes. Stitch-Dark, theme-token colors.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Coffee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatStack } from "../LiveFelt";

interface LevelRow {
  level_number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

export function StructurePanel({ tournamentId, currentLevel }: { tournamentId: string; currentLevel?: number | null }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LevelRow[] | null>(null);
  const activeRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("tournament_levels")
        .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
        .eq("tournament_id", tournamentId)
        .order("level_number", { ascending: true });
      if (!alive) return;
      setRows((data ?? []) as LevelRow[]);
    })();
    return () => {
      alive = false;
    };
  }, [tournamentId]);

  // Scroll the live level into view once the rows render.
  useEffect(() => {
    if (rows && rows.length) {
      activeRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
    }
  }, [rows]);

  if (rows === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/40 py-10 text-center text-sm text-muted-foreground">
        {t("liveHub.structure.empty", "Chưa có cấu trúc mù")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">{t("liveHub.structure.level", "Lv")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("liveHub.structure.blinds", "Mù (SB/BB)")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("liveHub.structure.ante", "Ante")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("liveHub.structure.time", "Phút")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isActive = currentLevel != null && !r.is_break && r.level_number === currentLevel;
            if (r.is_break) {
              return (
                <tr key={`b-${r.level_number}`} className="border-t border-border/30 bg-[hsl(var(--poker-accent)/0.1)]">
                  <td colSpan={4} className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "hsl(var(--poker-accent))" }}>
                      <Coffee className="h-3.5 w-3.5" />
                      {t("liveHub.structure.break", "Nghỉ giải lao")} · {r.duration_minutes}'
                    </span>
                  </td>
                </tr>
              );
            }
            return (
              <tr
                key={r.level_number}
                ref={isActive ? activeRef : undefined}
                className={`border-t border-border/30 ${isActive ? "bg-[hsl(var(--success)/0.12)]" : ""}`}
              >
                <td className="px-3 py-2">
                  <span className={`tracker-num font-bold ${isActive ? "" : "text-foreground"}`} style={isActive ? { color: "hsl(var(--success))" } : undefined}>
                    {r.level_number}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tracker-num font-semibold text-foreground">
                  {formatStack(r.small_blind)} / {formatStack(r.big_blind)}
                </td>
                <td className="px-3 py-2 text-right tracker-num text-muted-foreground">
                  {r.ante ? formatStack(r.ante) : "—"}
                </td>
                <td className="px-3 py-2 text-right tracker-num text-muted-foreground">{r.duration_minutes}'</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
