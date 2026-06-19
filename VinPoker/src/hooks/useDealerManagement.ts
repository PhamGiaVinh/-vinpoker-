import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DealerRecord {
  id: string;
  club_id: string;
  full_name: string;
  tier: string;
  status: string;
  employment_type: string | null;
  hourly_rate_vnd: number | null;
  base_rate_vnd: number | null;
  monthly_salary_vnd: number | null;
  standard_hours_per_shift: number | null;
  ot_multiplier: number | null;
  joined_date: string | null;
  notes: string | null;
  phone: string | null;
  telegram_user_id: number | null;
  telegram_username: string | null;
}

export interface DealerScore {
  dealer_id: string;
  full_name: string;
  tier: string;
  club_id: string;
  employment_type: string | null;
  total_hours: number;
  total_swings: number;
  score: number;
}

// ── Polling hook ──────────────────────────────────────────────────────────────

function usePollingQuery<T>(
  queryFn: () => Promise<T[]>,
  deps: unknown[],
  intervalMs: number
): { data: T[]; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const queryFnRef = useRef(queryFn);
  const generationRef = useRef(0);
  queryFnRef.current = queryFn;

  const fetch = useCallback(async () => {
    const gen = ++generationRef.current;
    try {
      const rows = await queryFnRef.current();
      if (gen === generationRef.current) {
        setData(rows);
        setError(null);
      }
    } catch (e: any) {
      if (gen === generationRef.current) {
        setError(e?.message ?? "Unknown error");
      }
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = window.setInterval(fetch, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch: fetch };
}

// ── Exported hooks ────────────────────────────────────────────────────────────

export function useAllDealers(clubIds: string[]): {
  data: DealerRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  return usePollingQuery<DealerRecord>(
    async () => {
      const { data, error } = await supabase
        .from("dealers")
        .select(
          "id, club_id, full_name, tier, status, employment_type, hourly_rate_vnd, base_rate_vnd, monthly_salary_vnd, standard_hours_per_shift, ot_multiplier, joined_date, notes, phone, telegram_user_id, telegram_username" +
          (FEATURES.manualPayrollDeductions ? ", manual_bhxh_vnd, manual_tax_vnd" : "")
        )
        .in("club_id", clubIds)
        .is("deleted_at", null)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as DealerRecord[];
    },
    [[...clubIds].sort().join(",")],
    30_000
  );
}

export function useDealerScores(clubId: string): {
  data: DealerScore[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  return usePollingQuery<DealerScore>(
    async () => {
      const { data, error } = await (supabase as any)
        .from("dealer_scores")
        .select("*")
        .eq("club_id", clubId)
        .order("score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DealerScore[];
    },
    [clubId],
    60_000
  );
}
