import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useTdAi } from "@/hooks/useTdAi";
import { TdAiQuestionForm } from "./TdAiQuestionForm";
import { TdAiAnswerCard } from "./TdAiAnswerCard";
import type { TdSituation } from "@/lib/tdai/types";

/**
 * "Hỏi TD AI" assistant. PR E: real answer via the td-ai-assistant edge
 * function (Gemini), with automatic fallback to PR D offline keyword lookup
 * (useTdAi). Advisory only — never an official ruling; no incident save (PR F).
 * Role re-checked here (defense in depth) on top of the gated entry button.
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
  const { answer, loading, ask, reset } = useTdAi();

  if (!isStaffOps && !isClubAdmin) return null;

  const handleSubmit = (situation: TdSituation) => {
    void ask({ ...situation, tournamentId });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-400" /> {t("tdAi.title")}
          </DialogTitle>
          <DialogDescription>{t("tdAi.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <TdAiQuestionForm tournamentId={tournamentId} onSubmit={handleSubmit} />

          {loading && (
            <div className="space-y-2 border-t border-border/60 pt-4" aria-busy="true">
              <div className="text-xs text-muted-foreground">{t("tdAi.loading")}</div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {!loading && answer && (
            <div className="border-t border-border/60 pt-4">
              <TdAiAnswerCard answer={answer} />
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={reset}>
                {t("tdAi.newLookup")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
