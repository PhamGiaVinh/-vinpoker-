import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  resolveDealerPhoneRollout,
  type DealerPhoneRolloutState,
} from "@/lib/dealerSwingPhone";

interface RolloutResult {
  allowed: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type AbortableRpc = {
  abortSignal: (signal: AbortSignal) => PromiseLike<RpcResult>;
};

export function useDealerSwingPhoneRollout(clubId: string | null): RolloutResult {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();

    if (!clubId) {
      setAllowed(false);
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }

    setAllowed(false);
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const rpc = supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => AbortableRpc;
        const response = await rpc("get_dealer_swing_phone_rollout", {
          p_expected_club_id: clubId,
        }).abortSignal(controller.signal);
        if (response.error) throw response.error;

        const state = response.data as DealerPhoneRolloutState | null;
        const nextAllowed = resolveDealerPhoneRollout(
          state,
          FEATURES.opsSwingPhoneCompletion,
        );
        if (generation === generationRef.current && !controller.signal.aborted) {
          setAllowed(nextAllowed);
          setError(null);
        }
      } catch (caught) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setAllowed(false);
        setError((caught as Error)?.message || "Không kiểm tra được quyền mở tính năng.");
      } finally {
        if (generation === generationRef.current && !controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      generationRef.current += 1;
    };
  }, [clubId, nonce]);

  return {
    allowed,
    loading,
    error,
    refetch: () => setNonce((value) => value + 1),
  };
}
