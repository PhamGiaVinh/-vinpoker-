import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import { buildLocalAnswer } from "@/lib/tdai/buildLocalAnswer";
import { TD_RULES_CORPUS } from "@/lib/tdai/corpus";
import type { TdAnswer, TdSituation } from "@/lib/tdai/types";

// Kill switch: the remote `td-ai-assistant` Edge Function (Gemini) is called
// ONLY when FEATURES.tdAiRemote is true. By default it is OFF — `ask` answers
// purely from the local keyword corpus and NEVER touches the network/Edge
// Function. When the flag is on, the remote path runs and still falls back to
// local lookup on ANY failure (function absent, network, 429/402, error). The
// answer's `source` ('ai' | 'local') drives the banner in TdAiAnswerCard.
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
    // Kill switch OFF (default): local keyword lookup only — no Edge Function,
    // no network, no Gemini. Return before any invoke.
    if (!FEATURES.tdAiRemote) {
      setAnswer(buildLocalAnswer(situation, TD_RULES_CORPUS));
      return;
    }

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
