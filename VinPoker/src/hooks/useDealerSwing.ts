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
import { useLiveClock } from "@/hooks/useLiveClock";
import type { TournamentWithTables, SwingConfigOverride, EffectiveSwingConfig } from "@/types/tournament";
import {
  derivePreAssignStatus,
  pickPreferredAssignment,
  type PreAssignStatus,
} from "@/lib/dealerSwingState";
import {
  buildBreakPoolEntries,
  DEFAULT_BREAK_DURATION_MINUTES,
  type BreakPoolEntry,
} from "@/lib/breakPoolState";

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
    club_id: string;
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
  updated_at: string;
  last_swing_attempted_at: string | null;
  swing_in_progress: boolean | null;
  swing_processed_at: string | null;
  swing_due_at: string | null;
  pre_assigned_attendance_id: string | null;
  pre_assigned_at: string | null;
  overtime_started_at: string | null;
  pre_assign_status: PreAssignStatus;
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

export interface PreAssignedInfo {
  attendance_id: string;
  full_name: string;
  telegram_username: string | null;
  tier: string;
}

interface BreakAssignmentRow {
  id: string;
  attendance_id: string;
  released_at: string | null;
  game_tables: {
    table_name: string;
  } | null;
}

interface RegularBreakRow {
  id: string;
  assignment_id: string;
  break_start: string;
  expected_duration_minutes: number | null;
  reason: string | null;
}

interface MealBreakRow {
  id: string;
  attendance_id: string;
  break_start: string;
  total_duration_minutes: number;
  base_duration_minutes: number | null;
  bonus_minutes: number | null;
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
  const result = useRealtimeQuery<DealerAttendance>({
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
        .in("dealers.club_id", clubIds)
        .order("check_in_time", { ascending: true }),
    realtimeTables: ["dealer_attendance"],
    clubIds,
  });

  // Deduplicate by dealer_id — re-check-in creates duplicate checked_in records
  // (INSERT new record, shift_date differs from original), causing inflated counts.
  // Keep only the latest record per dealer (most recent check_in_time wins).
  const deduped = useMemo(() => {
    const map = new Map<string, DealerAttendance>();
    for (const d of result.data) {
      const existing = map.get(d.dealer_id);
      if (!existing || d.check_in_time! > existing.check_in_time!) {
        map.set(d.dealer_id, d);
      }
    }
    return Array.from(map.values());
  }, [result.data]);

  return { ...result, data: deduped };
}

/** Fetch today's checked-out dealers so they appear in a "Đã check-out" panel for quick re-check-in.
 *  Uses two-step query:
 *    1. Get dealers with active checked_in today (to exclude)
 *    2. Get checked_out dealers excluding active ones
 *  This ensures a dealer who re-checked-in (INSERT new record) does NOT
 *  still appear in the checked-out list because their OLD checked_out record
 *  is shadowed by their NEW checked_in record.
 */
export type { BreakPoolEntry } from "@/lib/breakPoolState";

export function useBreakPool(
  clubIds: string[],
  dealers: DealerAttendance[],
  swingConfigs: SwingConfig[] = [],
) {
  const dealersKey = useMemo(
    () => dealers
      .map((dealer) => `${dealer.id}:${dealer.current_state}:${dealer.check_in_time ?? ""}`)
      .sort()
      .join("|"),
    [dealers],
  );
  const configKey = useMemo(
    () => swingConfigs
      .map((config) => `${config.club_id}:${config.table_type}:${config.break_duration_minutes}`)
      .sort()
      .join("|"),
    [swingConfigs],
  );

  const result = useRealtimeQuery<BreakPoolEntry>({
    queryFn: async () => {
      const onBreakDealers = dealers.filter(
        (dealer) => dealer.status === "checked_in" && dealer.current_state === "on_break",
      );
      if (!clubIds.length || onBreakDealers.length === 0) {
        return { data: [], error: null };
      }

      const attendanceIds = onBreakDealers.map((dealer) => dealer.id);
      const defaultBreakMinutesByClubId = Object.fromEntries(
        swingConfigs
          .filter((config) => config.table_type === "tournament")
          .map((config) => [
            config.club_id,
            config.break_duration_minutes ?? DEFAULT_BREAK_DURATION_MINUTES,
          ]),
      );

      const { data: breakAssignments, error: assignmentError } = await supabase
        .from("dealer_assignments")
        .select(`
          id,
          attendance_id,
          released_at,
          game_tables(table_name)
        `)
        .in("attendance_id", attendanceIds)
        .eq("status", "on_break")
        .order("released_at", { ascending: false });

      if (assignmentError) {
        return { data: null, error: assignmentError };
      }

      const assignmentIds = (breakAssignments ?? []).map((assignment: any) => assignment.id);
      const [{ data: regularBreaks, error: regularBreakError }, { data: mealBreaks, error: mealBreakError }] =
        await Promise.all([
          assignmentIds.length > 0
            ? supabase
                .from("dealer_breaks")
                .select("id, assignment_id, break_start, expected_duration_minutes, reason")
                .in("assignment_id", assignmentIds)
                .is("break_end", null)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("dealer_meal_breaks")
            .select("id, attendance_id, break_start, total_duration_minutes, base_duration_minutes, bonus_minutes")
            .in("attendance_id", attendanceIds)
            .eq("status", "active"),
        ]);

      if (regularBreakError || mealBreakError) {
        return { data: null, error: regularBreakError ?? mealBreakError };
      }

      return {
        data: buildBreakPoolEntries({
          nowMs: Date.now(),
          dealers: onBreakDealers.map((dealer) => ({
            attendanceId: dealer.id,
            dealerId: dealer.dealer_id,
            clubId: dealer.dealers.club_id ?? null,
            fullName: dealer.dealers.full_name,
            telegramUsername: dealer.dealers.telegram_username ?? null,
            tier: dealer.dealers.tier ?? "C",
            checkInTime: dealer.check_in_time,
            currentState: dealer.current_state,
          })),
          regularAssignments: (breakAssignments ?? []).map((assignment: any) => ({
            assignmentId: assignment.id,
            attendanceId: assignment.attendance_id,
            releasedAt: assignment.released_at,
            tableName: assignment.game_tables?.table_name ?? null,
          })) as BreakAssignmentRow[],
          regularBreaks: (regularBreaks ?? []).map((breakRow: any) => ({
            id: breakRow.id,
            assignmentId: breakRow.assignment_id,
            breakStart: breakRow.break_start,
            expectedDurationMinutes: breakRow.expected_duration_minutes,
            reason: breakRow.reason,
          })) as RegularBreakRow[],
          mealBreaks: (mealBreaks ?? []).map((breakRow: any) => ({
            id: breakRow.id,
            attendanceId: breakRow.attendance_id,
            breakStart: breakRow.break_start,
            totalDurationMinutes: breakRow.total_duration_minutes,
            baseDurationMinutes: breakRow.base_duration_minutes,
            bonusMinutes: breakRow.bonus_minutes,
          })) as MealBreakRow[],
          defaultBreakMinutesByClubId,
        }),
        error: null,
      };
    },
    realtimeTables: ["dealer_breaks", "dealer_meal_breaks", "dealer_assignments", "dealer_attendance"],
    clubIds,
  });

  useEffect(() => {
    result.refetch();
  }, [dealersKey, configKey, result.refetch]);

  return result;
}

export function useTodayCheckedOutDealers(clubIds: string[]) {
  const today = new Date().toISOString().split("T")[0];
  return useRealtimeQuery<DealerAttendance>({
    queryFn: async () => {
      if (!clubIds.length) return [];

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

function useActiveAssignments(clubIds: string[], shiftId?: string) {
  return useRealtimeQuery<DealerAssignment>({
    queryFn: async () => {
       let q = supabase
         .from("dealer_assignments")
         .select(
            `id, attendance_id, table_id, assigned_at, released_at, status,
             version, updated_at, last_swing_attempted_at, swing_in_progress,
             swing_processed_at, swing_due_at,
             pre_assigned_attendance_id, pre_assigned_at,
             overtime_started_at,
             game_tables!inner(id, table_name, table_type, status, club_id),
             dealer_attendance!attendance_id(current_state, dealers(full_name, telegram_username)),
             pre_assigned:dealer_attendance!pre_assigned_attendance_id(dealers(full_name, telegram_username, tier))`
        )
        .in("status", ["assigned"])
        .in("game_tables.club_id", clubIds)
        .neq("dealer_attendance.current_state", "on_break")
        .neq("dealer_attendance.current_state", "checked_out");

      if (shiftId) {
        q = q.eq("game_tables.shift_id", shiftId);
      }

      return q.order("assigned_at", { ascending: true });
    },
    realtimeTables: ["dealer_assignments", "dealer_attendance"],
    clubIds,
  });
}

/** Timeline enrichment — adds minutesLeft, showNextDealerSoon, isOverdue per assignment */
export function useActiveAssignmentsWithTimeline(clubIds: string[]) {
  const now = useLiveClock();
  const result = useActiveAssignments(clubIds);

  const canonicalAssignments = useMemo(() => {
    const byTableId = new Map<string, DealerAssignment>();
    for (const assignment of result.data ?? []) {
      byTableId.set(
        assignment.table_id,
        pickPreferredAssignment(byTableId.get(assignment.table_id), assignment, now)
      );
    }
    return Array.from(byTableId.values());
  }, [result.data, now]);

  const enriched = useMemo(() => {
    return canonicalAssignments.map((a) => {
      const due = a.swing_due_at ? new Date(a.swing_due_at).getTime() : null;
      if (!due) {
        return {
          ...a,
          pre_assign_status: derivePreAssignStatus(a, now),
          minutesLeft: null,
          secondsLeft: null,
          showNextDealerSoon: false,
          isOverdue: false,
        };
      }
      const diffMs = due - now;
      const minutesLeft = Math.max(0, diffMs / 60000);
      const showNextDealerSoon = minutesLeft <= 5;
      const preAssignStatus = derivePreAssignStatus(a, now);
      const isOverdue = diffMs < 0 && preAssignStatus !== "valid" && preAssignStatus !== "in_progress";
      return {
        ...a,
        pre_assign_status: preAssignStatus,
        minutesLeft,
        secondsLeft: Math.max(0, Math.floor(diffMs / 1000)),
        showNextDealerSoon,
        isOverdue,
      };
    });
  }, [canonicalAssignments, now]);

  return { ...result, data: enriched };
}

export function useActiveTables(clubIds: string[]) {
  return useRealtimeQuery({
    queryFn: async () =>
      supabase
        .from("game_tables")
        .select("*")
        .in("club_id", clubIds)
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
  rotation_planner_enabled?: boolean;
}

interface SwingMetrics {
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
    const map: Record<string, PreAssignedInfo> = {};
    for (const a of assignments ?? []) {
      const pre = a.pre_assigned;
      if (a.pre_assigned_attendance_id && pre?.dealers) {
        map[a.table_id] = {
          attendance_id: a.pre_assigned_attendance_id,
          full_name: pre.dealers.full_name,
          telegram_username: pre.dealers.telegram_username ?? null,
          tier: pre.dealers.tier,
        };
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
 * - Auto-resets after 5000ms (server refetch should have landed by then)
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
    }, 5000);
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
  preAssignStatus: PreAssignStatus;
}

interface OvertimeDealer {
  assignmentId: string;
  tableId: string;
  tableName: string;
  attendanceId: string;
  dealerName: string;
  overtimeStartedAt: string;
  swingDueAt: string | null;
  priorityBreakFlag: boolean;
}

function useOvertimeDealers(clubIds: string[]) {
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

export function useNextDealerPredictions(clubIds: string[], assignments: DealerAssignment[] = []) {
  const [data, setData] = useState<Record<string, NextDealerPrediction> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (clubIds.length === 0) { setData({}); setLoading(false); return; }
    const cid = clubIds[0];
    const assignmentByTableId = new Map(assignments.map((assignment) => [assignment.table_id, assignment]));
    setLoading(true);
    const { data: rows, error } = await supabase
      .rpc("get_table_assignments_with_next", { p_club_id: cid });
    if (error) {
      console.error("[useNextDealerPredictions] RPC error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      setData(null);
    } else {
      const arr = (rows as any[]) ?? [];
      const map: Record<string, NextDealerPrediction> = {};
      for (const r of arr) {
        map[r.table_id] = {
          tableId: r.table_id,
          tableName: r.table_name,
          currentDealerName: r.current_dealer,
          currentState: null,
          workedMinutes: 0,
          swingDueAt: null,
          minutesUntilSwing: r.minutes_until_swing,
          nextDealerName: r.next_dealer,
          nextDealerId: null,
          confidence: r.next_dealer ? "confirmed" : "predicted",
          preAssignStatus: assignmentByTableId.get(r.table_id)?.pre_assign_status ?? "none",
        };
      }
      setData(map);
    }
    setLoading(false);
  }, [clubIds.join(","), assignments]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const refetch = useCallback(() => { load(); }, [load]);

  return { data, loading, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWING CONFIG RESOLVER — Pure function (no hooks)
// Resolves table → tournament → club hierarchy for swing config
// ═══════════════════════════════════════════════════════════════════════════════

interface ResolvedSwingConfig {
  swing_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  source: "table" | "tournament" | "club" | "default";
}

function resolveEffectiveSwingConfig(
  tableId: string,
  tournaments: TournamentWithTables[] | undefined,
  tableOverrides: SwingConfigOverride[] | undefined,
  clubDefault: { swing_duration_minutes: number; warn_at_minutes: number; crit_at_minutes: number } | undefined
): ResolvedSwingConfig {
  // Priority 1: Table override (swing_configs table)
  const tableOverride = tableOverrides?.find(
    (c) => c.scope_type === "table" && c.scope_id === tableId
  );
  if (tableOverride) {
    return {
      swing_duration_minutes: tableOverride.swing_duration_minutes,
      warn_at_minutes: tableOverride.warn_at_minutes,
      crit_at_minutes: tableOverride.crit_at_minutes,
      source: "table",
    };
  }

  // Priority 2: Tournament config
  const tournament = tournaments?.find((t) =>
    t.tournament_tables.some((tt) => tt.table_id === tableId)
  );
  if (tournament) {
    return {
      swing_duration_minutes: tournament.swing_duration_minutes,
      warn_at_minutes: tournament.warn_at_minutes,
      crit_at_minutes: tournament.crit_at_minutes,
      source: "tournament",
    };
  }

  // Priority 3: Club default (from swing_config or swing_configs)
  if (clubDefault) {
    return {
      swing_duration_minutes: clubDefault.swing_duration_minutes,
      warn_at_minutes: clubDefault.warn_at_minutes,
      crit_at_minutes: clubDefault.crit_at_minutes,
      source: "club",
    };
  }

  // Fallback
  return {
    swing_duration_minutes: 45,
    warn_at_minutes: 5,
    crit_at_minutes: 2,
    source: "default",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook: Fetch table-level overrides from swing_configs table
// ═══════════════════════════════════════════════════════════════════════════════

function useTableConfigOverrides(clubIds: string[]) {
  const [data, setData] = useState<SwingConfigOverride[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase
      .from("swing_configs")
      .select("*")
      .in("club_id", clubIds);
    setData((d ?? []) as SwingConfigOverride[]);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook: Build per-table swing config map
// Combines tournaments + table overrides + club default into a single map
// ═══════════════════════════════════════════════════════════════════════════════

function useTableSwingConfigMap(
  clubIds: string[],
  tableIds: string[],
  tournaments: TournamentWithTables[] | undefined,
  clubDefault: { swing_duration_minutes: number; warn_at_minutes: number; crit_at_minutes: number } | undefined
) {
  const { data: tableOverrides } = useTableConfigOverrides(clubIds);

  const configMap = useMemo(() => {
    const map = new Map<string, ResolvedSwingConfig>();
    for (const tableId of tableIds) {
      map.set(
        tableId,
        resolveEffectiveSwingConfig(tableId, tournaments, tableOverrides ?? undefined, clubDefault)
      );
    }
    return map;
  }, [tableIds.join(","), tournaments, tableOverrides, clubDefault?.swing_duration_minutes]);

  return configMap;
}
