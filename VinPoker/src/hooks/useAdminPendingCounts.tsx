import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AdminPendingCounts {
  result_entered: number;
  release_requested: number;
  result_disputed: number;
  total: number;
}

export function useAdminPendingCounts() {
  const { isStaffOps: isAdmin } = useAuth();
  const [counts, setCounts] = useState<AdminPendingCounts>({
    result_entered: 0,
    release_requested: 0,
    result_disputed: 0,
    total: 0,
  });

  const fetchCounts = useCallback(async () => {
    if (!isAdmin) return;
    const statuses = ["result_entered", "release_requested", "result_disputed"] as const;
    const results = await Promise.all(
      statuses.map((s) =>
        supabase.from("staking_deals").select("id", { count: "exact", head: true }).eq("status", s),
      ),
    );
    const c = {
      result_entered: results[0].count ?? 0,
      release_requested: results[1].count ?? 0,
      result_disputed: results[2].count ?? 0,
      total: 0,
    };
    c.total = c.result_entered + c.release_requested + c.result_disputed;
    setCounts(c);
  }, [isAdmin]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("admin-pending-counts")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "staking_deals" }, () => fetchCounts())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin, fetchCounts]);

  return counts;
}
