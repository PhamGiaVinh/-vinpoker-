import { useTranslation } from "react-i18next";
import { Check, Gauge, Lock } from "lucide-react";
import { DrillCategory, DrillResult } from "@/lib/pokerIQ";
import { cn } from "@/lib/utils";

const Section = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>
);

function Bar({ label, score, amber }: { label: string; score: number; amber?: boolean }) {
  return (
    <div className="my-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className={cn("text-xs font-medium", amber ? "text-[hsl(var(--warning))]" : "text-primary")}>{score}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", amber ? "bg-[hsl(var(--warning))]" : "bg-primary")}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export function ResultCard({ result }: { result: DrillResult }) {
  const { t } = useTranslation();
  const cat = (c: DrillCategory) => t(`pokerDrill.category.${c}`);
  const scoreOf = (c: DrillCategory) => result.categoryScores.find((x) => x.category === c)?.score ?? 0;
  const styleLabel = t(`pokerDrill.archetype.${result.archetype}`);
  const drillLabel = cat(result.recommendedDrill);

  return (
    <div className="flex flex-col gap-3">
      {/* Header + private badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
          {t("pokerDrill.result.kicker")}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t("pokerDrill.result.private")}
        </span>
      </div>

      {/* Hero */}
      <Section className="border-t-2 border-t-primary">
        <div className="text-xs text-muted-foreground">{t("pokerDrill.result.profileLabel")}</div>
        <div className="mt-2.5 flex items-center gap-3.5">
          <div className="flex flex-col items-center">
            <div className="text-[34px] font-medium leading-none text-primary">{result.grade}</div>
            <span className="mt-1.5 rounded-full bg-[hsl(var(--warning)/0.16)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--warning))]">
              {t("pokerDrill.result.provisional")}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-medium text-foreground">{styleLabel}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("pokerDrill.result.scoreLabel")}: <span className="text-foreground">{result.totalScore}</span>/100
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${result.totalScore}%` }} />
            </div>
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground/90">
              <Gauge className="h-3 w-3" aria-hidden="true" />
              {t("pokerDrill.result.confidence", { level: t(`pokerDrill.confLevel.${result.confidence}`) })}
            </span>
          </div>
        </div>
        <div className="my-3.5 h-px bg-border" />
        <p className="text-[13.5px] leading-relaxed text-foreground">{t("pokerDrill.result.interpretation")}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t("pokerDrill.result.nextHook")}</p>
      </Section>

      {/* Why this grade */}
      <Section>
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
          {t("pokerDrill.result.whyTitle")}
        </div>
        {result.categoryScores.map((c) => (
          <Bar key={c.category} label={cat(c.category)} score={c.score} amber={c.category === result.weakestCategory} />
        ))}
        <div className="mt-3 flex gap-2.5 rounded-xl border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.1)] p-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--warning))]" />
          <p className="text-[12.5px] leading-snug text-foreground">
            {t("pokerDrill.result.weakest", {
              category: cat(result.weakestCategory),
              score: scoreOf(result.weakestCategory),
              insight: t(`pokerDrill.insight.${result.weakestCategory}`),
            })}
          </p>
        </div>
      </Section>

      {/* Strengths */}
      <Section>
        <div className="mb-2.5 text-sm font-medium text-foreground">{t("pokerDrill.result.strengthsTitle")}</div>
        <div className="flex flex-wrap gap-2">
          {result.strengths.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t(`pokerDrill.strength.${s}`)}
            </span>
          ))}
        </div>
      </Section>

      {/* Leaks (private) */}
      <Section className="border-[hsl(var(--warning)/0.3)]">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{t("pokerDrill.result.weaknessesTitle")}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {t("pokerDrill.result.private")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.leaks.map((l) => (
            <span
              key={l}
              className="inline-flex items-center whitespace-nowrap rounded-full border border-[hsl(var(--warning)/0.34)] bg-[hsl(var(--warning)/0.14)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--warning))]"
            >
              {t(`pokerDrill.leak.${l}`)}
            </span>
          ))}
        </div>
      </Section>

      {/* Training journey */}
      <Section>
        <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
          {t("pokerDrill.result.trainingKicker")}
        </div>
        <div className="mt-1 text-[15px] font-medium text-foreground">{t("pokerDrill.result.trainingGoal")}</div>
        <ol className="mt-3 space-y-2.5">
          {[
            t("pokerDrill.result.step1", { drill: drillLabel }),
            t("pokerDrill.result.step2"),
            t("pokerDrill.result.step3"),
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-snug text-foreground">
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-primary">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Section>

      {/* Suggested event */}
      <Section>
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
          {t("pokerDrill.result.eventsTitle")}
        </div>
        <div className="mb-2.5 flex gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div>
            <div className="text-[13.5px] font-medium text-foreground">{t(`pokerDrill.event.${result.suggestedEvent.fit}`)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t("pokerDrill.eventReason.fit", { style: styleLabel })}</div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--warning))]" />
          <div>
            <div className="text-[13.5px] font-medium text-[hsl(var(--warning))]">
              {t("pokerDrill.result.eventAvoidPrefix")} {t(`pokerDrill.event.${result.suggestedEvent.avoid}`)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t("pokerDrill.eventReason.avoid")}</div>
          </div>
        </div>
      </Section>

      {/* Locked outlook teaser */}
      <Section className="border-dashed">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("pokerDrill.result.outlookTitle")}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("pokerDrill.result.outlookIntro")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["outlookItm", "outlookFt", "outlookLadder", "outlookVerified"].map((k) => (
            <span
              key={k}
              className="whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground/80"
            >
              {t(`pokerDrill.result.${k}`)}
            </span>
          ))}
        </div>
      </Section>

      {/* Mandatory disclaimer */}
      <div className="rounded-xl bg-muted p-3 text-[11.5px] leading-relaxed text-muted-foreground">
        {t("pokerDrill.result.disclaimer")}
      </div>
    </div>
  );
}
