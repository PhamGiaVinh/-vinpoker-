/**
 * hooks/useRotationSchedule.ts
 *
 * Loads LIVE rows from `dealer_rotation_schedule` (the source of truth for
 * forward rotation plans) for a set of club ids and keeps them fresh via
 * Supabase Realtime postgres_changes (same conventions as useDealerSwing's
 * useRealtimeQuery: realtime subscription + poll fallback).
 *
 * Live rows = status IN ('predicted','announced','executing').
 *
 * NOTE: `dealer_rotation_schedule` is not yet in the generated
 * src/integrations/supabase/types.ts, so queries are typed with explicit
 * local interfaces and `as any` casts (same pattern as other untyped RPCs
 * in the repo, e.g. useDealerPayroll.ts).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RotationScheduleStatus =
  | "predicted"
  | "announced"
  | "executing"
  | "executed"
  | "cancelled"
  | "no_show"
  | "superseded";

export interface RotationScheduleRow {
  id: string;
  club_id: string;
  table_id: string;
  assignment_id: string | null;
  /** 0 = TIẾP THEO, 1..2 = DỰ ĐOÁN */
  slot_index: number;
  out_attendance_id: string | null;
  in_attendance_id: string | null;
  planned_relief_at: string | null;
  announce_at: string | null;
  status: RotationScheduleStatus;
  is_shortage: boolean;
  is_emergency: boolean;
  plan_run_id: string | null;
  solver_version: string | null;
  score: number | null;
  reason: unknown;
  version: number;
  created_at: string;
  updated_at: string;
  /** Resolved from dealer_attendance → dealers (best-effort, may be null). */
  in_dealer_name: string | null;
  in_dealer_tier: string | null;
}

export interface RotationTableSlots {
  slot0?: RotationScheduleRow;
  slot1?: RotationScheduleRow;
  slot2?: RotationScheduleRow;
}

export interface UseRotationScheduleResult {
  rows: RotationScheduleRow[];
  byTableId: Record<string, RotationTableSlots>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const LIVE_STATUSES: RotationScheduleStatus[] = ["predicted", "announced", "executing"];

/** announced/executing beat predicted when two live rows collide on a slot. */
const STATUS_RANK: Record<string, number> = { executing: 3, announced: 2, predicted: 1 };

async function fetchLiveScheduleRows(clubIds: string[]): Promise<{ data: RotationScheduleRow[] | null; error: any }> {
  const { data: rows, error } = await (supabase as any)
    .from("dealer_rotation_schedule")
    .select(
      "id, club_id, table_id, assignment_id, slot_index, out_attendance_id, in_attendance_id, planned_relief_at, announce_at, status, is_shortage, is_emergency, plan_run_id, solver_version, score, reason, version, created_at, updated_at"
    )
    .in("club_id", clubIds)
    .in("status", LIVE_STATUSES)
    .order("slot_index", { ascending: true });

  if (error) return { data: null, error };

  const scheduleRows = (rows ?? []) as Omit<RotationScheduleRow, "in_dealer_name" | "in_dealer_tier">[];

  // ── Cheap name resolution: one query over dealer_attendance → dealers ──
  const inIds = [
    ...new Set(scheduleRows.map((r) => r.in_attendance_id).filter(Boolean) as string[]),
  ];
  const nameByAttendanceId = new Map<string, { full_name: string; tier: string | null }>();
  if (inIds.length > 0) {
    const { data: atts, error: attError } = await supabase
      .from("dealer_attendance")
      .select("id, dealers(full_name, tier)")
      .in("id", inIds);
    if (!attError) {
      for (const att of (atts ?? []) as any[]) {
        if (att?.dealers?.full_name) {
          nameByAttendanceId.set(att.id, {
            full_name: att.dealers.full_name,
            tier: att.dealers.tier ?? null,
          });
        }
      }
    }
    // Name resolution failure is non-fatal — consumers can fall back to
    // their own dealer maps; the schedule row itself is still authoritative.
  }

  const enriched: RotationScheduleRow[] = scheduleRows.map((r) => {
    const resolved = r.in_attendance_id ? nameByAttendanceId.get(r.in_attendance_id) : undefined;
    return {
      ...r,
      in_dealer_name: resolved?.full_name ?? null,
      in_dealer_tier: resolved?.tier ?? null,
    };
  });

  return { data: enriched, error: null };
}

export function useRotationSchedule(
  clubIdsOrId: string[] | string,
  pollFallbackMs = 60_000
): UseRotationScheduleResult {
  const clubIds = useMemo(
    () => (Array.isArray(clubIdsOrId) ? clubIdsOrId : clubIdsOrId ? [clubIdsOrId] : []),
    [Array.isArray(clubIdsOrId) ? [...clubIdsOrId].sort().join(",") : clubIdsOrId]
  );

  const [rows, setRows] = useState<RotationScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  /** Unique per-hook-instance id to prevent channel name collision. */
  const instanceId = useRef(Math.random().toString(36).slice(2, 8)).current;
  const clubIdsRef = useRef(clubIds);
  useEffect(() => { clubIdsRef.current = clubIds; }, [clubIds]);

  const refetch = useCallback(async () => {
    const gen = ++generationRef.current;
    const ids = clubIdsRef.current;
    if (!ids.length) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: err } = await fetchLiveScheduleRows(ids);
      if (gen !== generationRef.current) return;
      if (err) {
        const msg = (err as any)?.message || JSON.stringify(err);
        console.error("[useRotationSchedule] error:", msg);
        setError(msg);
        setRows([]);
      } else {
        setError(null);
        setRows(data ?? []);
      }
    } catch (e) {
      if (gen !== generationRef.current) return;
      const msg = (e as Error)?.message || "Unknown error";
      console.error("[useRotationSchedule] threw:", msg);
      setError(msg);
      setRows([]);
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clubIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    refetch();

    const ids = [...clubIds].sort().join("+");
    const channel = supabase.channel(`rotation-schedule:${ids}:${instanceId}`);

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dealer_rotation_schedule" },
      () => { refetch(); }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.debug("[useRotationSchedule] Realtime connected");
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[useRotationSchedule] Realtime error, falling back to poll");
      }
    });

    channelRef.current = channel;
    pollTimerRef.current = window.setInterval(refetch, pollFallbackMs);

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...clubIds].sort().join(","), pollFallbackMs]);

  const byTableId = useMemo(() => {
    const map: Record<string, RotationTableSlots> = {};
    for (const row of rows) {
      const slots = (map[row.table_id] ??= {});
      const key = row.slot_index === 0 ? "slot0" : row.slot_index === 1 ? "slot1" : row.slot_index === 2 ? "slot2" : null;
      if (!key) continue;
      const existing = slots[key];
      if (
        !existing ||
        (STATUS_RANK[row.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0) ||
        ((STATUS_RANK[row.status] ?? 0) === (STATUS_RANK[existing.status] ?? 0) &&
          row.updated_at > existing.updated_at)
      ) {
        slots[key] = row;
      }
    }
    return map;
  }, [rows]);

  return { rows, byTableId, loading, error, refetch };
}
