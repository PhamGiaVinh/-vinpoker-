import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Dealer {
  id: string;
  full_name: string;
  tier: string;
  status: string;
  phone?: string;
}

export interface DealerAttendance {
  id: string;
  dealer_id: string;
  shift_date: string;
  status: string;
  check_in_time: string | null;
  check_out_time: string | null;
  overtime_minutes: number;
  dealers: Dealer;
  shift_id?: string | null;
  current_state?: 'available' | 'assigned' | 'on_break' | 'checked_out';
  worked_minutes_since_last_break?: number;
  priority_break_flag?: boolean;
}

export interface GameTable {
  id: string;
  table_name: string;
  table_type: string;
  status: string;
  current_blind_level: number;
  down_count: number;
  club_id?: string;
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
  game_tables: GameTable;
  dealer_attendance: DealerAttendance;
}

export interface SwingConfig {
  id: string;
  club_id: string;
  table_type: string;
  swing_duration_minutes: number;
  break_duration_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  break_return_policy: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  payload: any;
  created_at: string;
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

export interface SwingAuditLog {
  id: string;
  club_id: string;
  shift_id?: string | null;
  assignment_id?: string | null;
  old_dealer_id?: string | null;
  new_dealer_id?: string | null;
  table_id?: string | null;
  action: string;
  details?: any;
  triggered_by: string;
  error_message?: string | null;
  created_at: string;
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

export function useCheckedInDealers(clubIds: string[], shiftId?: string) {
  const [data, setData] = useState<DealerAttendance[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    let q = supabase
      .from("dealer_attendance")
      .select("id, dealer_id, shift_id, shift_date, status, check_in_time, check_out_time, overtime_minutes, current_state, worked_minutes_since_last_break, priority_break_flag, dealers!inner(id, full_name, tier, status)")
      .eq("shift_date", today)
      .eq("status", "checked_in")
      .in("dealers.club_id", clubIds);
    if (shiftId) q = q.eq("shift_id", shiftId);
    const { data: d } = await q;
    setData((d ?? []) as any);
    setLoading(false);
  }, [clubIds.join(","), shiftId]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

export function useActiveTables(clubIds: string[]) {
  const [data, setData] = useState<(GameTable & { current_assignment?: DealerAssignment | null })[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: tables } = await supabase
      .from("game_tables")
      .select("id, table_name, table_type, status, current_blind_level, down_count")
      .eq("status", "active")
      .in("club_id", clubIds)
      .order("table_name");
    setData((tables ?? []) as any);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
}

export function useActiveAssignments(clubIds: string[], shiftId?: string) {
  const [data, setData] = useState<DealerAssignment[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    let q = supabase
      .from("dealer_assignments")
      .select(`
        id, attendance_id, table_id, assigned_at, released_at, status, version, swing_processed_at,
        game_tables!inner(id, table_name, table_type, status, current_blind_level, down_count, club_id),
        dealer_attendance!inner(id, dealer_id, shift_id, shift_date, status, check_in_time, check_out_time, overtime_minutes,
          dealers!inner(id, full_name, tier, status))
      `)
      .in("status", ["assigned", "on_break"])
      .in("game_tables.club_id", clubIds);
    if (shiftId) q = q.eq("dealer_attendance.shift_id", shiftId);
    const { data: d } = await q;
    setData((d ?? []) as any);
    setLoading(false);
  }, [clubIds.join(","), shiftId]);

  useEffect(() => { load(); }, [load]);

  // Polling every 30s instead of real-time subscription (reduces lag)
  useEffect(() => {
    if (!clubIds.length) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [clubIds.join(","), shiftId]);

  return { data, loading, refetch: load };
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

export function useAuditLogs(clubIds: string[], limit = 20) {
  const [data, setData] = useState<AuditLog[] | null>(null);

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
