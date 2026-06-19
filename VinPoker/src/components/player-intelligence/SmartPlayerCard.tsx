import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Info, Lock, Play, Sparkles, Trophy } from "lucide-react";
import {
  formatConfidence,
  formatPercent,
  formatProfileStatus,
  formatScenarioWindow,
  formatSourceQuality,
  getNextBestAction,
  isRawObservedRate,
  isScenarioUnlocked,
  NextActionKey,
  usePlayerIntelligence,
} from "@/lib/player-intelligence";
import { cn } from "@/lib/utils";

const Section = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>
);

const ACTION_ROUTE: Record<NextActionKey, string> = {
  play_drill: "/poker-iq",
  join_first_event: "/",
  keep_playing_recorded: "/",
  see_fit_events: "/",
  track_progress: "/",
};

export function SmartPlayerCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: pi, isLoading, isError } = usePlayerIntelligence();
  const [sqOpen, setSqOpen] = useState(false);

  if (isLoading) {
    return (
      <Section>
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-16 animate-pulse rounded bg-muted/60" />
      </Section>
    );
  }
  if (isError || !pi) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4" aria-hidden="true" />
          {t("playerIntelligence.error")}
        </div>
      </Section>
    );
  }

  const locale = i18n.language?.startsWith("en") ? "en-US" : i18n.language || "vi-VN";
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const hasSample = pi.verifiedSample.totalEntries > 0;
  const r = pi.results;
  const hasResults = [r.itmRate, r.finalTableRate, r.top3Rate, r.avgNormalizedFinish].some((x) => x != null);
  const unlocked = isScenarioUnlocked(pi);
  const actions = getNextBestAction(pi);

  const Chip = ({ tone, children }: { tone: "neon" | "amber" | "muted"; children: React.ReactNode }) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        tone === "neon" && "bg-primary/12 text-primary",
        tone === "amber" && "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]",
        tone === "muted" && "border border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* A — Header */}
      <Section className="border-t-2 border-t-primary">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-[15px] font-medium text-foreground">{t("playerIntelligence.header.title")}</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Chip tone={pi.profileStatus === "verified" ? "neon" : "amber"}>{t(formatProfileStatus(pi.profileStatus))}</Chip>
            <Chip tone="muted">
              {t("playerIntelligence.confidenceLabel")}: {t(formatConfidence(pi.confidence))}
            </Chip>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{t("playerIntelligence.header.subtitle")}</p>
      </Section>

      {/* B — Verified sample */}
      <Section>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
          {t("playerIntelligence.sample.title")}
        </div>
        {hasSample ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { l: "sample.totalEntries", v: String(pi.verifiedSample.totalEntries) },
              { l: "sample.uniqueEvents", v: String(pi.verifiedSample.uniqueEvents) },
              { l: "sample.reentries", v: String(pi.verifiedSample.reentries) },
              { l: "sample.lastPlayed", v: fmtDate(pi.verifiedSample.lastPlayedAt) },
            ].map((s) => (
              <div key={s.l} className="rounded-lg bg-muted/40 p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`playerIntelligence.${s.l}`)}</div>
                <div className="mt-0.5 text-base font-medium text-foreground">{s.v}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("playerIntelligence.sample.empty")}</p>
        )}
      </Section>

      {/* C — Observed results */}
      {hasResults && (
        <Section>
          <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
            {t("playerIntelligence.results.title")}
          </div>
          <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">{t("playerIntelligence.results.subtitle")}</p>
          {r.itmRate != null && <Row label={t("playerIntelligence.results.itm")} value={formatPercent(r.itmRate) ?? "—"} />}
          {r.finalTableRate != null && <Row label={t("playerIntelligence.results.ft")} value={formatPercent(r.finalTableRate) ?? "—"} />}
          {r.top3Rate != null && <Row label={t("playerIntelligence.results.top3")} value={formatPercent(r.top3Rate) ?? "—"} />}
          {r.avgNormalizedFinish != null && (
            <Row label={t("playerIntelligence.results.avgFinish")} value={formatPercent(r.avgNormalizedFinish) ?? "—"} />
          )}
        </Section>
      )}

      {/* D — Source quality (collapsible) */}
      <Section>
        <button
          type="button"
          onClick={() => setSqOpen((o) => !o)}
          aria-expanded={sqOpen}
          className="flex w-full items-center justify-between text-[13px] font-medium text-foreground"
        >
          <span>{t("playerIntelligence.sourceQuality.title")}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {sqOpen ? t("playerIntelligence.sourceQuality.hide") : t("playerIntelligence.sourceQuality.show")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", sqOpen && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
        {sqOpen && (
          <div className="mt-2">
            <Row label={t("playerIntelligence.sourceQuality.finishPosition")} value={t(formatSourceQuality(pi.sourceQuality.finishPosition))} />
            <Row label={t("playerIntelligence.sourceQuality.itm")} value={t(formatSourceQuality(pi.sourceQuality.itm))} />
            <Row label={t("playerIntelligence.sourceQuality.fieldSize")} value={t(formatSourceQuality(pi.sourceQuality.fieldSize))} />
            <Row label={t("playerIntelligence.sourceQuality.structure")} value={t(formatSourceQuality(pi.sourceQuality.structure))} />
            <Row label={t("playerIntelligence.sourceQuality.identity")} value={t(formatSourceQuality(pi.sourceQuality.identity))} />
            <Row label={t("playerIntelligence.sourceQuality.rateMethod")} value={t(formatSourceQuality(pi.scenarioOutlook.basedOn.rateMethod))} />
            {isRawObservedRate(pi) && (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t("playerIntelligence.sourceQuality.rawObservedNote")}</p>
            )}
          </div>
        )}
      </Section>

      {/* E — Scenario outlook */}
      <Section className={cn(!unlocked && "border-dashed")}>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
          {!unlocked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
          {t("playerIntelligence.outlook.title")}
          {!unlocked && <span className="text-[hsl(var(--warning))]">· {t("playerIntelligence.outlook.lockedTitle")}</span>}
        </div>
        {unlocked ? (
          <div className="mt-2.5 flex flex-col gap-2">
            {pi.scenarioOutlook.windows.map((w) => {
              const v = formatScenarioWindow(w);
              return (
                <div key={w.tournaments} className="rounded-xl border border-border bg-background/40 p-2.5">
                  <div className="text-[12.5px] font-medium text-foreground">
                    {t("playerIntelligence.outlook.windowTitle", { n: w.tournaments })}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{t("playerIntelligence.outlook.expectedItm")}: <b className="font-medium text-foreground">{v.expectedText ?? "—"}</b></span>
                    <span>{t("playerIntelligence.outlook.chanceItm")}: <b className="font-medium text-primary">{v.chanceText ?? "—"}</b></span>
                  </div>
                </div>
              );
            })}
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("playerIntelligence.outlook.basis")}</p>
            <p className="text-[11px] leading-snug text-muted-foreground">{t("playerIntelligence.outlook.softNote")}</p>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {t(`playerIntelligence.outlook.reason.${pi.scenarioOutlook.reasonLocked ?? "not_enough_verified_entries"}`)}
          </p>
        )}
      </Section>

      {/* F — Next action */}
      <Section>
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
          {t("playerIntelligence.action.title")}
        </div>
        <div className="flex flex-col gap-2">
          {actions.map((a, i) => (
            <button
              key={a}
              type="button"
              onClick={() => navigate(ACTION_ROUTE[a])}
              className={cn(
                "flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors",
                i === 0 ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2">
                {a === "play_drill" && <Play className="h-4 w-4" aria-hidden="true" />}
                {a === "see_fit_events" && <Sparkles className="h-4 w-4" aria-hidden="true" />}
                {t(`playerIntelligence.action.${a}`)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
