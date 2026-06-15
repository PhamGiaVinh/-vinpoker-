import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useTdAi } from "@/hooks/useTdAi";
import { TdAiQuestionForm } from "./TdAiQuestionForm";
import { TdAiAnswerCard } from "./TdAiAnswerCard";
import type { TdSituation } from "@/lib/tdai/types";

/**
 * Inline "Hỏi TD AI" assistant rendered as a Floor tab panel. Same engine as
 * TdAiAssistantPanel (useTdAi → offline keyword lookup; remote Edge Function is
 * flag-gated dark), just presented inline instead of in a dialog so floor staff
 * can keep it open beside the table map. Advisory only — never an official ruling.
 * Role re-checked here (defense in depth) on top of the floor-mode entry.
 */
export function TdAiTabPanel({ tournamentId }: { tournamentId?: string }) {
  const { t } = useTranslation();
  const { isStaffOps, isClubAdmin } = useAuth();
  const { answer, loading, ask, reset } = useTdAi();

  if (!isStaffOps && !isClubAdmin) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Chỉ nhân sự vận hành mới dùng được trợ lý TD AI.
      </Card>
    );
  }

  const handleSubmit = (situation: TdSituation) => {
    void ask({ ...situation, tournamentId });
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-5 w-5 text-emerald-400" /> {t("tdAi.title")}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("tdAi.subtitle")}</p>
      </div>

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
    </Card>
  );
}
