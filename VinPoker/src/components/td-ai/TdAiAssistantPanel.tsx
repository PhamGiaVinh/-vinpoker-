import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { TdAiQuestionForm } from "./TdAiQuestionForm";
import { TdAiAnswerCard } from "./TdAiAnswerCard";
import { buildLocalAnswer } from "@/lib/tdai/buildLocalAnswer";
import { MOCK_TD_RULES } from "@/lib/tdai/mockRules";
import type { TdAnswer, TdSituation } from "@/lib/tdai/types";

/**
 * "Hỏi TD AI" assistant — PR D UI shell. Local DEMO keyword lookup only:
 * no LLM call, no DB, no incident save. Role re-checked here (defense in
 * depth) on top of the gated entry button. PR E swaps buildLocalAnswer for a
 * real edge-function call returning the same TdAnswer shape.
 */
export function TdAiAssistantPanel({
  open,
  onOpenChange,
  tournamentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId?: string;
}) {
  const { t } = useTranslation();
  const { isStaffOps, isClubAdmin } = useAuth();
  const [answer, setAnswer] = useState<TdAnswer | null>(null);

  // Defense in depth — the entry button is already gated, but never render
  // the assistant for a non-staff session even if it is somehow opened.
  if (!isStaffOps && !isClubAdmin) return null;

  const handleSubmit = (situation: TdSituation) => {
    setAnswer(buildLocalAnswer(situation, MOCK_TD_RULES));
  };

  const reset = (next: boolean) => {
    if (!next) setAnswer(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-400" /> {t("tdAi.title")}
          </DialogTitle>
          <DialogDescription>{t("tdAi.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <TdAiQuestionForm tournamentId={tournamentId} onSubmit={handleSubmit} />
          {answer && (
            <div className="border-t border-border/60 pt-4">
              <TdAiAnswerCard answer={answer} />
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setAnswer(null)}>
                {t("tdAi.newLookup")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
