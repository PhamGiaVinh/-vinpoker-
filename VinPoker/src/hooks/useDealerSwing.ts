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

export interface Tour {
  id: string;
  club_id: string;
  tour_name: string;
  start_time: string;
  end_time: string;
}

export function useTours(clubIds: string[]) {
  const [data, setData] = useState<Tour[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase
      .from("dealer_shifts")
      .select("*")
      .in("club_id", clubIds)
      .order("start_time");
    setData(d ?? []);
    setLoading(false);
  }, [clubIds.join(",")]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refetch: load };
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
      .select("id, dealer_id, shift_id, shift_date, status, check_in_time, check_out_time, overtime_minutes, dealers!inner(id, full_name, tier, status)")
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

  // Real-time subscription for live updates
  useEffect(() => {
    if (!clubIds.length) return;
    const ch = supabase
      .channel("dealer_assignments_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "dealer_assignments" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clubIds.join(","), shiftId]);

  return { data, loading, refetch: load };
}

export function useSwingConfigs(clubIds: string[]) {
  const [data, setData] = useState<SwingConfig[] | null>(null);

  useEffect(() => {
    if (!clubIds.length) { setData([]); return; }
    (async () => {
      const { data: d } = await supabase
        .from("swing_config")
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
