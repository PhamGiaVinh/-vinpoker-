import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Calendar, ChevronRight, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DrillResult, rankBestFit, ScoredEvent, UpcomingEvent } from "@/lib/pokerIQ";
import { cn } from "@/lib/utils";

const Section = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>
);

/** Upcoming tournaments from the clubs' posted schedule (next ~3 weeks, read-only). */
function useUpcomingEvents() {
  return useQuery({
    queryKey: ["pokerIqUpcomingEvents"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<UpcomingEvent[]> => {
      const now = new Date();
      const horizon = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from("tournaments")
        .select("id,name,start_time,buy_in,starting_stack,minutes_per_level,game_type,location, club:clubs(name,region)")
        .gte("start_time", now.toISOString())
        .lte("start_time", horizon.toISOString())
        .order("start_time", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        startTime: r.start_time,
        buyIn: r.buy_in ?? null,
        startingStack: r.starting_stack ?? null,
        minutesPerLevel: r.minutes_per_level ?? null,
        gameType: r.game_type ?? null,
        location: r.location ?? null,
        clubName: r.club?.name ?? null,
      }));
    },
  });
}

export function BestFitEventsCard({ result }: { result: DrillResult }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: events = [], isLoading, isError } = useUpcomingEvents();

  const ranked = useMemo(() => rankBestFit(result, events), [result, events]);
  const good = ranked.good.slice(0, 3);
  const avoid = ranked.avoid.slice(0, 1);
  const styleLabel = t(`pokerDrill.archetype.${result.archetype}`);

  const locale = i18n.language?.startsWith("en") ? "en-US" : i18n.language || "vi-VN";
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" });
  const fmtBuyIn = (n: number | null) => (n == null ? "" : Number(n).toLocaleString(locale));

  const Row = ({ s, tone }: { s: ScoredEvent; tone: "good" | "avoid" }) => (
    <button
      type="button"
      onClick={() => navigate(`/tournament/${s.event.id}`)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-left transition-colors hover:border-border/80"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-foreground">{s.event.name}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              s.structure === "turbo"
                ? "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]"
                : "bg-primary/10 text-primary",
            )}
          >
            {t(`pokerDrill.bestFit.structure.${s.structure}`)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {[s.event.clubName, fmtDate(s.event.startTime), s.event.buyIn != null ? fmtBuyIn(s.event.buyIn) : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className={cn("mt-0.5 block text-[11px]", tone === "avoid" ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>
          {tone === "avoid"
            ? `${t("pokerDrill.bestFit.avoidTag")} — ${t("pokerDrill.bestFit.reason.avoid")}`
            : t(`pokerDrill.bestFit.reason.${s.reasonKey}`, { style: styleLabel })}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );

  return (
    <Section>
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {t("pokerDrill.bestFit.weekTitle")}
      </div>

      {/* Style-fit guidance (always shown — works even with no upcoming events) */}
      <p className="text-xs text-muted-foreground">{t("pokerDrill.eventReason.fit", { style: styleLabel })}</p>

      {isLoading && <p className="mt-3 text-xs text-muted-foreground">{t("pokerDrill.bestFit.loading")}</p>}

      {!isLoading && (good.length > 0 || avoid.length > 0) && (
        <div className="mt-3 flex flex-col gap-2">
          {good.map((s) => (
            <Row key={s.event.id} s={s} tone="good" />
          ))}
          {avoid.map((s) => (
            <Row key={s.event.id} s={s} tone="avoid" />
          ))}
        </div>
      )}

      {!isLoading && good.length === 0 && avoid.length === 0 && (
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {isError ? t("pokerDrill.bestFit.viewAll") : t("pokerDrill.bestFit.empty")}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {t("pokerDrill.bestFit.disclaimer")}
      </p>
    </Section>
  );
}
