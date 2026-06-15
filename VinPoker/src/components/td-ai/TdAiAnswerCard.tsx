import { useTranslation } from "react-i18next";
import { AlertTriangle, Save, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TdAiCitation } from "./TdAiCitation";
import { TD_DEMO_NOTICE_VI } from "@/lib/tdai/buildLocalAnswer";
import { dominantCategory, CATEGORY_I18N_KEY } from "@/lib/tdai/categories";
import type { TdAnswer, TdConfidence, TdRuleCategory } from "@/lib/tdai/types";

const CONFIDENCE_STYLE: Record<TdConfidence, string> = {
  low: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

const CATEGORY_STYLE: Record<TdRuleCategory, string> = {
  ruling: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  floor: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  operations: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  strategy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

/** Fixed answer-card layout. Always shows the DEMO banner — never a ruling. */
export function TdAiAnswerCard({ answer }: { answer: TdAnswer }) {
  const { t } = useTranslation();
  const category = dominantCategory(answer.matchedRuleIds);
  return (
    <div className="space-y-4">
      {/* Domain chip + source — what kind of help this is and where it came from. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {category && (
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_STYLE[category]}`}>
            {t(CATEGORY_I18N_KEY[category])}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          {answer.source === "ai" ? t("tdAi.source.ai") : t("tdAi.source.local")}
        </span>
      </div>

      {/* Advisory banner — always visible. AI answers and the offline keyword
          fallback get different wording, but BOTH say it is not a ruling. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{answer.source === "ai" ? t("tdAi.advisoryBanner") : TD_DEMO_NOTICE_VI}</span>
      </div>

      <Section title={t("tdAi.answer.recommendation")}>{answer.recommendationVi}</Section>

      <Section title={t("tdAi.answer.basis")}>
        {answer.citations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {answer.citations.map((c) => (
              <TdAiCitation key={c.ruleId} citation={c} />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">{t("tdAi.answer.noBasis")}</span>
        )}
      </Section>

      <Section title={t("tdAi.answer.reasoning")}>{answer.reasoningVi}</Section>
      <Section title={t("tdAi.answer.houseOption")}>{answer.houseRuleOptionVi}</Section>
      <Section title={t("tdAi.answer.playerWording")}>
        <span className="italic">“{answer.playerWordingVi}”</span>
      </Section>

      <Section title={t("tdAi.answer.confidence")}>
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLE[answer.confidence]}`}>
          {t(`tdAi.confidence.${answer.confidence}`)}
        </span>
      </Section>

      {answer.needMoreInfoVi.length > 0 && (
        <Section title={t("tdAi.answer.needMore")}>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {answer.needMoreInfoVi.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* PR F actions — intentionally disabled in PR D */}
      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button size="sm" variant="outline" disabled title={t("tdAi.actions.prF")}>
          <Save className="mr-1 h-3.5 w-3.5" /> {t("tdAi.actions.saveIncident")}
          <span className="ml-1.5 rounded bg-muted px-1 text-[9px] uppercase tracking-wide">PR F</span>
        </Button>
        <Button size="sm" variant="outline" disabled title={t("tdAi.actions.prF")}>
          <Megaphone className="mr-1 h-3.5 w-3.5" /> {t("tdAi.actions.reportTd")}
          <span className="ml-1.5 rounded bg-muted px-1 text-[9px] uppercase tracking-wide">PR F</span>
        </Button>
      </div>
    </div>
  );
}
