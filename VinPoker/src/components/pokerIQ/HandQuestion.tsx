import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { DrillAnswer, DrillHand, SelfConfidence } from "@/lib/pokerIQ";
import { cn } from "@/lib/utils";

interface Props {
  hand: DrillHand;
  index: number;
  total: number;
  onAnswer: (answer: DrillAnswer) => void;
}

const CONF_LEVELS: SelfConfidence[] = ["low", "medium", "high"];

function HandCard({ token }: { token: string }) {
  const rank = token.slice(0, -1);
  const suit = token.slice(-1);
  const red = suit === "♥" || suit === "♦";
  return (
    <div className="flex h-12 w-9 flex-col items-center justify-center rounded-md bg-white text-sm font-semibold leading-none shadow-sm">
      <span className={cn(red ? "text-[#d11f2a]" : "text-[#15181c]")}>{rank}</span>
      <span className={cn("text-base", red ? "text-[#d11f2a]" : "text-[#15181c]")}>{suit}</span>
    </div>
  );
}

/** One drill hand: scenario, hole cards on a felt strip, options, self-confidence. */
export function HandQuestion({ hand, index, total, onAnswer }: Props) {
  const { t } = useTranslation();
  const [optionId, setOptionId] = useState<string | null>(null);
  const [conf, setConf] = useState<SelfConfidence | null>(null);

  const tokens = hand.heroHand.split(" ").filter(Boolean);
  const canNext = Boolean(optionId && conf);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
        {t("pokerDrill.play.progress", { n: index + 1, total })}
      </div>

      {/* Drill table visual — red felt is allowed inside the poker-table visual only. */}
      <div className="flex items-center gap-3 rounded-xl border border-[hsl(355_40%_24%)] bg-[hsl(355_42%_15%)] p-3">
        <div className="flex gap-1.5">
          {tokens.map((tk) => (
            <HandCard key={tk} token={tk} />
          ))}
        </div>
        <div className="min-w-0 text-xs text-white/80">
          <div className="font-medium text-white">{hand.position}</div>
          <div>
            {t("pokerDrill.play.stack")}: {hand.stackBb}BB
          </div>
          <div>
            {t("pokerDrill.play.villain")}: {hand.villainProfile}
          </div>
        </div>
      </div>

      <p className="text-[15px] leading-relaxed text-foreground">{hand.scenario}</p>

      <div className="text-xs text-muted-foreground">{t("pokerDrill.play.choosePrompt")}</div>
      <div className="flex flex-col gap-2">
        {hand.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={optionId === opt.id}
            onClick={() => setOptionId(opt.id)}
            className={cn(
              "min-h-[44px] rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
              optionId === opt.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-foreground hover:border-border/80",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mt-1">
        <div className="mb-2 text-xs text-muted-foreground">{t("pokerDrill.play.confidenceQ")}</div>
        <div className="flex gap-2">
          {CONF_LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              aria-pressed={conf === lvl}
              onClick={() => setConf(lvl)}
              className={cn(
                "min-h-[40px] flex-1 rounded-lg border px-2 text-xs font-medium transition-colors",
                conf === lvl
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t(`pokerDrill.confLevel.${lvl}`)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={!canNext}
        onClick={() => optionId && conf && onAnswer({ handId: hand.id, optionId, selfConfidence: conf })}
        className={cn(
          "mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-opacity",
          canNext ? "bg-primary text-primary-foreground" : "cursor-not-allowed bg-muted text-muted-foreground opacity-60",
        )}
      >
        {index + 1 >= total ? t("pokerDrill.play.finish") : t("pokerDrill.play.next")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
