import { useEffect, useState } from "react";
import { ScenarioKey, HandStrategy, scenarioKeyToString } from "@/lib/gto/cfrTypes";
import { solveCachedAsync } from "@/lib/gto/cfrCache";

export function useCfrSolver(key: ScenarioKey | null): {
  strategy: HandStrategy[] | null;
  loading: boolean;
} {
  const [strategy, setStrategy] = useState<HandStrategy[] | null>(null);
  const [loading, setLoading] = useState(false);

  const k = key ? scenarioKeyToString(key) : null;

  useEffect(() => {
    if (!key || !k) {
      setStrategy(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    solveCachedAsync(key).then((result) => {
      if (!cancelled) {
        setStrategy(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  return { strategy, loading };
}
