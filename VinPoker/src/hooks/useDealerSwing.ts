/**
 * hooks/useDealerSwing.ts  — REALTIME FIX
 *
 * [FIX-RT] Replace 30s polling with Supabase Realtime postgres_changes subscriptions.
 *          UI updates within ~200ms instead of up to 30 seconds.
 *
 * Pattern:
 *   - Subscribe to postgres_changes for relevant tables
 *   - On any change event, call refetch() to get fresh data
 *   - Keep 60s polling fallback in case realtime drops
 *   - Cleanup subscriptions on unmount
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DealerAttendance {
  id: string;
  dealer_id: string;
  shift_date: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  overtime_minutes: number;
  current_state:
    | "available"
    | "assigned"
    | "pre_assigned"
    | "on_break"
    | "checked_out";
  worked_minutes_since_last_break: number;
  priority_break_flag: boolean;
  dealers: {
    full_name: string;
    telegram_username?: string;
    tier: "A" | "B" | "C";
  };
}

export interface DealerAssignment {
  id: string;
  attendance_id: string;
  table_id: string;
  assigned_at: string;
  released_at: string | null;
  status: "assigned" | "on_break" | "completed";
  version: number;
  swing_processed_at: string | null;
  swing_due_at: string | null;
  pre_assigned_attendance_id: string | null;
  pre_assigned_at: string | null;
  overtime_started_at: string | null;
  game_tables: {
    id: string;
    table_name: string;
    table_type: string;
    status: string;
  };
  dealer_attendance: {
    current_state: string;
    dealers: {
      full_name: string;
      telegram_username?: string;
    };
  };
}

interface UseRealtimeQueryOptions<T> {
  queryFn: () => Promise<{ data: T[] | null; error: unknown }>;
  realtimeTables: string[];
  clubIds: string[];
  pollFallbackMs?: number;
}

function useRealtimeQuery<T>(
  options: UseRealtimeQueryOptions<T>
): { data: T[]; loading: boolean; error: string | null; refetch: () => void } {
  const { queryFn, realtimeTables, clubIds, pollFallbackMs = 60_000 } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const queryFnRef = useRef(queryFn);
  /** Unique per-hook-instance id to prevent channel name collision when
   *  multiple hooks subscribe to the same table (e.g. useCheckedInDealers
   *  + useTodayCheckedOutDealers both on dealer_attendance). */
  const instanceId = useRef(Math.random().toString(36).slice(2, 8)).current;
  useEffect(() => { queryFnRef.current = queryFn; }, [queryFn]);

  const refetch = useCallback(async () => {
    const gen = ++generationRef.current;
    try {
      const { data: rows, error } = await queryFnRef.current();
      if (gen !== generationRef.current) return;
      if (error) {
        const msg = (error as any)?.message || JSON.stringify(error);
        console.error("[useRealtimeQuery] error:", msg);
        setError(msg);
        setData([]);
      } else {
        setError(null);
        setData(rows ?? []);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = (e as Error)?.message || "Unknown error";
      console.error("[useRealtimeQuery] threw:", msg);
      setError(msg);
      setData([]);
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clubIds.length === 0) return;

    refetch();

    const ids = [...clubIds].sort().join("+");
    const tables = [...realtimeTables].sort().join("+");
    const channel = supabase.channel(`swing:${tables}:${ids}:${instanceId}`);

    for (const table of realtimeTables) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        () => {
          refetch();
        }
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.debug("[useRealtimeQuery] Realtime connected:", realtimeTables);
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[useRealtimeQuery] Realtime error, falling back to poll");
      }
    });

    channelRef.current = channel;

    pollTimerRef.current = window.setInterval(refetch, pollFallbackMs);

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [[...clubIds].sort().join(","), [...realtimeTables].sort().join(",")]);

  return { data, loading, error, refetch };
}

export function useCheckedInDealers(clubIds: string[]) {
  const today = new Date().toISOString().split("T")[0];
  return useRealtimeQuery<DealerAttendance>({
    queryFn: async () =>
      supabase
        .from("dealer_attendance")
        .select(
          `id, dealer_id, shift_date, status, check_in_time, check_out_time,
           overtime_minutes, current_state, worked_minutes_since_last_break,
           priority_break_flag,
           dealers!inner(full_name, telegram_username, tier, club_id)`
        )
        .eq("status", "checked_in")
        .gte("shift_date", today)
        .in("dealers.club_id", clubIds)
        .order("check_in_time", { ascending: true }),
    realtimeTables: ["dealer_attendance"],
    clubIds,
  });
}

/** Fetch today's checked-out dealers so they appear in a "Đã check-out" panel for quick re-check-in.
 *  Uses two-step query:
 *    1. Get dealers with active checked_in today (to exclude)
 *    2. Get checked_out dealers excluding active ones
 *  This ensures a dealer who re-checked-in (INSERT new record) does NOT
 *  still appear in the checked-out list because their OLD checked_out record
 *  is shadowed by their NEW checked_in record.
 */
export function useTodayCheckedOutDealers(clubIds: string[]) {
  const today = new Date().toISOString().split("T")[0];
  return useRealtimeQuery<DealerAttendance>({
    queryFn: async () => {
      // Step 1: get dealers with active checked_in today
      const { data: activeToday } = await supabase
        .from("dealer_attendance")
        .select("dealer_id")
        .in("dealers.club_id", clubIds)
        .eq("status", "checked_in")
        .gte("shift_date", today);
      const activeIds = [...new Set((activeToday ?? []).map((a) => a.dealer_id))];
      // Step 2: get checked_out dealers, excluding active ones
      let query = supabase
        .from("dealer_attendance")
        .select(
          `id, dealer_id, shift_date, status, check_in_time, check_out_time,
           overtime_minutes, current_state, worked_minutes_since_last_break,
           priority_break_flag,
           dealers!inner(full_name, telegram_username, tier, club_id)`
        )
        .eq("status", "checked_out")
        .gte("shift_date", today)
        .in("dealers.club_id", clubIds);
      if (activeIds.length > 0) {
        // PostgREST: column=not.in.(val1,val2) — no quotes for UUID type
        query = query.not("dealer_id", "in", `(${activeIds.join(",")})`);
      }
      return query.order("check_out_time", { ascending: false });
    },
    realtimeTables: ["dealer_attendance"],
    clubIds,
  });
}

export function useActiveAssignments(clubIds: string[], shiftId?: string) {
  return useRealtimeQuery<DealerAssignment>({
    queryFn: async () => {
      let q = supabase
        .from("dealer_assignments")
        .select(
           `id, attendance_id, table_id, assigned_at, released_at, status,
            version, swing_processed_at, swing_due_at,
            pre_assigned_attendance_id, pre_assigned_at,
            overtime_started_at,
            game_tables!inner(id, table_name, table_type, status, club_id),
            dealer_attendance!attendance_id(current_state, dealers(full_name, telegram_username))`
        )
        .in("status", ["assigned"])
        .in("game_tables.club_id", clubIds)
        .neq("dealer_attendance.current_state", "on_break");

      if (shiftId) {
        q = q.eq("game_tables.shift_id", shiftId);
      }

      return q.order("assigned_at", { ascending: true });
    },
    realtimeTables: ["dealer_assignments", "dealer_attendance"],
    clubIds,
  });
}

export function useActiveTables(clubIds: string[]) {
  return useRealtimeQuery({
    queryFn: async () =>
      supabase
        .from("game_tables")
        .select("*")
        .in("club_id", clubIds)
        .eq("status", "active")
        .order("table_name"),
    realtimeTables: ["game_tables"],
    clubIds,
  });
}

export function usePoolTables(clubIds: string[]) {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); setError(null); return; }
    setLoading(true);
    setError(null);

    const { data: rows, error: err } = await supabase
      .from("game_tables")
      .select("*")
      .in("club_id", clubIds)
      .order("table_name");

    if (err) {
      console.error("[usePoolTables] error:", err);
      setData([]);
      setError((err as any)?.message || "Lỗi tải bàn pool");
    } else {
      setData(rows ?? []);
      setError(null);
    }
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}

// ─── Legacy hooks (kept from original file) ──────────────────────────────────

export interface SwingConfig {
  id: string;
  club_id: string;
  table_type: string;
  swing_duration_minutes: number;
  break_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  break_return_policy: string;
  pre_announce_minutes?: number;
  tournament_mode?: string;
  auto_adjust_duration?: boolean;
  base_duration_minutes?: number;
  target_ratio?: number;
  min_duration_minutes?: number;
  max_duration_minutes?: number;
}

export interface SwingMetrics {
  id: string;
  club_id: string;
  date: string;
  total_swings: number;
  successful_swings: number;
  failed_swings: number;
  no_dealer_swings: number;
  avg_processing_time_ms: number | null;
  telegram_failures: number;
}

export interface ShiftBreakPolicy {
  id: string;
  club_id: string;
  shift_type: 'default' | 'morning' | 'afternoon' | 'graveyard';
  min_work_before_break_minutes: number;
  max_work_before_mandatory_break_minutes: number;
  target_break_duration_minutes: number;
  max_break_time_variance_minutes: number;
  created_at: string;
  updated_at: string;
}

export function useSwingConfigs(clubIds: string[]) {
  const [data, setData] = useState<SwingConfig[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase
      .from("swing_config")
      .select("*")
      .in("club_id", clubIds);
    setData(d ?? []);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

export function useSwingMetrics(clubIds: string[]) {
  const [data, setData] = useState<SwingMetrics[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    const { data: d } = await supabase
      .from("swing_metrics")
      .select("*")
      .in("club_id", clubIds)
      .eq("date", today);
    setData(d ?? []);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

export function useBreakPolicies(clubIds: string[]) {
  const [data, setData] = useState<ShiftBreakPolicy[] | null>(null);

  useEffect(() => {
    if (!clubIds.length) { setData([]); return; }
    (async () => {
      const { data: d } = await supabase
        .from("shift_break_policies")
        .select("*")
        .in("club_id", clubIds);
      setData(d ?? []);
    })();
  }, [clubIds.join(",")]);

  return data;
}

export function useSpecialDates(clubIds: string[]) {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase
      .from("special_dates")
      .select("*")
      .in("club_id", clubIds);
    setData(d ?? []);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

export function useAuditLogs(clubIds: string[], limit = 20) {
  const [data, setData] = useState<any[] | null>(null);

  useEffect(() => {
    if (!clubIds.length) { setData([]); return; }
    (async () => {
      const { data: d } = await supabase
        .from("audit_logs")
        .select("id, action, entity_type, payload, created_at")
        .in("club_id", clubIds)
        .order("created_at", { ascending: false })
        .limit(limit);
      setData(d ?? []);
    })();
  }, [clubIds.join(","), limit]);

  return data;
}

export function useAvailableTables(clubIds: string[]) {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); setError(null); return; }
    setLoading(true);
    setError(null);

    const { data: activeTables, error: err1 } = await supabase
      .from("game_tables")
      .select("id, table_name, table_type, status, current_blind_level, down_count, club_id")
      .eq("status", "active")
      .in("club_id", clubIds);

    if (err1) {
      console.error("[useAvailableTables] active tables error:", err1);
      setData([]);
      setError((err1 as any)?.message || "Lỗi tải bàn");
      setLoading(false);
      return;
    }
    if (!activeTables) { setData([]); setLoading(false); return; }

    const { data: assigned, error: err2 } = await supabase
      .from("dealer_assignments")
      .select("table_id")
      .in("status", ["assigned", "on_break"])
      .in("table_id", activeTables.map((t: any) => t.id));

    if (err2) {
      console.error("[useAvailableTables] assigned tables error:", err2);
      setData([]);
      setError((err2 as any)?.message || "Lỗi tải bàn đã gán");
      setLoading(false);
      return;
    }

    const assignedIds = new Set((assigned ?? []).map((a: any) => a.table_id));
    setData(activeTables.filter((t: any) => !assignedIds.has(t.id)));
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}

export function usePreAssignedDealers(assignments: any[]) {
  return useMemo(() => {
    const map = new Map<string, boolean>();
    for (const a of assignments ?? []) {
      if (a.pre_assigned_attendance_id) {
        map.set(a.attendance_id, true);
      }
    }
    return map;
  }, [assignments]);
}

/**
 * useOptimisticDealerCount
 *
 * Tracks checkout count optimistically so the badge updates instantly
 * on click, then reconciles when the realtime refetch lands.
 * - Optimistically decrement on checkout
 * - Auto-resets after 500ms (server refetch should have landed by then)
 *
 * Usage:
 *   const { optimistic: checkedInCount, onCheckout } = useOptimisticDealerCount(realCount);
 *   onCheckout(); // call when checkout button is clicked
 */
export function useOptimisticDealerCount(realCount: number) {
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const onCheckout = useCallback((count = 1) => {
    setOptimistic((prev) => (prev ?? realCount) - count);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOptimistic(null);
      timerRef.current = null;
    }, 500);
  }, [realCount]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    optimistic: optimistic ?? realCount,
    onCheckout,
  };
}

// ─── Next Dealer Predictions ───────────────────────────────────────────────

export interface NextDealerPrediction {
  tableId: string;
  tableName: string;
  currentDealerName: string | null;
  currentState: string | null;
  workedMinutes: number;
  swingDueAt: string | null;
  minutesUntilSwing: number;
  nextDealerName: string | null;
  nextDealerId: string | null;
  confidence: "confirmed" | "predicted";
}

export interface OvertimeDealer {
  assignmentId: string;
  tableId: string;
  tableName: string;
  attendanceId: string;
  dealerName: string;
  overtimeStartedAt: string;
  swingDueAt: string | null;
  priorityBreakFlag: boolean;
}

export function useOvertimeDealers(clubIds: string[]) {
  return useRealtimeQuery<OvertimeDealer>({
    queryFn: async () => {
      if (!clubIds.length) return { data: [], error: null };

      const { data, error } = await supabase
        .from("dealer_assignments")
        .select(`
          id,
          table_id,
          attendance_id,
          swing_due_at,
          overtime_started_at,
          priority_break_flag,
          game_tables!inner(table_name),
          dealer_attendance!attendance_id(
            dealers!inner(full_name)
          )
        `)
        .in("game_tables.club_id", clubIds)
        .eq("status", "assigned")
        .not("overtime_started_at", "is", null);

      if (error) return { data: null, error };

      const mapped: OvertimeDealer[] = (data ?? []).map((row: any) => ({
        assignmentId: row.id,
        tableId: row.table_id,
        tableName: row.game_tables?.table_name ?? "Unknown",
        attendanceId: row.attendance_id,
        dealerName: row.dealer_attendance?.dealers?.full_name ?? "Unknown",
        overtimeStartedAt: row.overtime_started_at,
        swingDueAt: row.swing_due_at,
        priorityBreakFlag: row.priority_break_flag ?? false,
      }));

      return { data: mapped, error: null };
    },
    realtimeTables: ["dealer_assignments"],
    clubIds,
  });
}

export function useNextDealerPredictions(clubIds: string[]) {
  const [data, setData] = useState<Record<string, NextDealerPrediction> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const cid = clubIds[0];
    if (!cid) { setData({}); return; }
    setLoading(true);
    const { data: rows, error } = await supabase
      .rpc("predict_next_dealers", { p_club_id: cid });
    if (error) {
      console.error("[useNextDealerPredictions] error:", error);
      setData(null);
    } else {
      const arr = (rows as NextDealerPrediction[]) ?? [];
      const map: Record<string, NextDealerPrediction> = {};
      for (const r of arr) map[r.tableId] = r;
      setData(map);
    }
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}
