import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildLocalAnswer } from "@/lib/tdai/buildLocalAnswer";
import { TD_RULES_CORPUS } from "@/lib/tdai/corpus";
import type { TdAnswer, TdSituation } from "@/lib/tdai/types";

// Calls the td-ai-assistant edge function (real Gemini answer). On ANY failure
// — function not deployed, network, rate limit (429), credits (402), or error
// payload — it falls back to the PR D offline keyword lookup over the SAME
// corpus, so the assistant always returns a safe, labelled answer. The answer's
// `source` ('ai' | 'local') drives the banner in TdAiAnswerCard.
export interface UseTdAi {
  answer: TdAnswer | null;
  loading: boolean;
  ask: (situation: TdSituation) => Promise<void>;
  reset: () => void;
}

export function useTdAi(): UseTdAi {
  const [answer, setAnswer] = useState<TdAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (situation: TdSituation) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("td-ai-assistant", { body: situation });
      if (error || !data || (data as { error?: string }).error || !(data as TdAnswer).recommendationVi) {
        setAnswer(buildLocalAnswer(situation, TD_RULES_CORPUS));
        return;
      }
      setAnswer(data as TdAnswer);
    } catch {
      setAnswer(buildLocalAnswer(situation, TD_RULES_CORPUS));
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => setAnswer(null), []);

  return { answer, loading, ask, reset };
}
