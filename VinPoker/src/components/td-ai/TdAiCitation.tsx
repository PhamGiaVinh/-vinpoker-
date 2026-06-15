import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { findCorpusRule } from "@/lib/tdai/categories";
import type { TdCitation } from "@/lib/tdai/types";

/**
 * Clickable citation badge. Tapping it opens the cited corpus entry's text
 * (topic + summary + suggested handling) so the floor can read what the
 * citation refers to. The text is a paraphrased, non-authoritative SUMMARY —
 * the popover says so — not verbatim official TDA text.
 */
export function TdAiCitation({ citation }: { citation: TdCitation }) {
  const { t } = useTranslation();
  const rule = findCorpusRule(citation.ruleId);
  const color =
    citation.kind === "house_demo" || citation.kind === "house"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${color}`}
          title={t("tdAi.citation.viewHint")}
        >
          {citation.label}
          <Info className="h-3 w-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {citation.label}
        </div>
        {rule ? (
          <>
            <div className="text-sm font-semibold text-foreground">{rule.topicVi}</div>
            <p className="text-sm leading-relaxed text-foreground">{rule.summaryVi}</p>
            {rule.suggestionVi && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold">{t("tdAi.citation.suggestion")}:</span> {rule.suggestionVi}
              </p>
            )}
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-300">
              {t("tdAi.citation.disclaimer")}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("tdAi.citation.notFound")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
