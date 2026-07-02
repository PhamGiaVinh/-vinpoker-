// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — persisted run/assignment status per date (range)
// ═══════════════════════════════════════════════════════════════════════════════
// The live planner hook (useShiftPlanner) always re-runs the AI draft and never
// loads what was actually SAVED/PUBLISHED — so after Publish the operator used
// to silently see a fresh AI draft. This hook fills that gap: for a club and a
// set of dates it reads dealer_schedule_runs (draft/published headers) and the
// persisted dealer_shift_assignments, powering:
//   • the "Lịch ngày X đã phát hành lúc HH:mm" banner + read-only mode
//   • the week strip's per-day status dots
//   • Step 4's per-dealer "đã xác nhận / đã vào ca" chips
// READ-ONLY, planner tables only — never dealer_attendance / swing / payroll.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RunStatusDay {
  status: "draft" | "published" | null;
  publishedAt: string | null;
  runId: string | null;
}

export interface PersistedAssignment {
  id: string;
  runId: string | null;
  dealerId: string;
  templateId: string | null;
  workDate: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  role: string;
  status: string; // draft | published | confirmed | checked_in | closed | cancelled | no_show
}

export interface UseScheduleRunStatusResult {
  /** date (YYYY-MM-DD) → best run header (published wins over draft). */
  runsByDate: Record<string, RunStatusDay>;
  /** date → live (non-cancelled) persisted assignments. */
  assignmentsByDate: Record<string, PersistedAssignment[]>;
  loading: boolean;
  refetch: () => void;
}

// dealer_shift_* tables aren't in the generated types (migration owner-gated) →
// untyped client, same pattern as useShiftPlanner.
const db = supabase as unknown as { from: (table: string) => any };

export function useScheduleRunStatus({
  clubId,
  dates,
  enabled = true,
}: {
  clubId: string | null | undefined;
  dates: string[];
  /** false in mock mode → returns empty, no query. */
  enabled?: boolean;
}): UseScheduleRunStatusResult {
  const [runsByDate, setRunsByDate] = useState<Record<string, RunStatusDay>>({});
  const [assignmentsByDate, setAssignmentsByDate] = useState<Record<string, PersistedAssignment[]>>({});
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const dateKey = useMemo(() => [...dates].sort().join(","), [dates]);

  const load = useCallback(async () => {
    if (!enabled || !clubId || dates.length === 0) {
      setRunsByDate({});
      setAssignmentsByDate({});
      return;
    }
    setLoading(true);
    try {
      const [runsRes, asgRes] = await Promise.all([
        db
          .from("dealer_schedule_runs")
          .select("id, work_date, status, published_at")
          .eq("club_id", clubId)
          .in("work_date", dates),
        db
          .from("dealer_shift_assignments")
          .select("id, run_id, dealer_id, template_id, work_date, scheduled_start_at, scheduled_end_at, role, status")
          .eq("club_id", clubId)
          .in("work_date", dates),
      ]);
      if (runsRes.error) throw runsRes.error;
      if (asgRes.error) throw asgRes.error;

      const runs: Record<string, RunStatusDay> = {};
      for (const r of (runsRes.data ?? []) as any[]) {
        const prev = runs[r.work_date];
        // published beats draft; superseded rows never override either.
        if (r.status === "published" || (!prev && r.status === "draft")) {
          if (!prev || prev.status !== "published" || r.status === "published") {
            runs[r.work_date] = { status: r.status, publishedAt: r.published_at ?? null, runId: r.id };
          }
        }
      }

      const byDate: Record<string, PersistedAssignment[]> = {};
      for (const a of (asgRes.data ?? []) as any[]) {
        if (a.status === "cancelled" || a.status === "no_show") continue;
        (byDate[a.work_date] ??= []).push({
          id: a.id,
          runId: a.run_id ?? null,
          dealerId: a.dealer_id,
          templateId: a.template_id ?? null,
          workDate: a.work_date,
          scheduledStartAt: a.scheduled_start_at,
          scheduledEndAt: a.scheduled_end_at,
          role: a.role ?? "Dealer",
          status: a.status,
        });
      }

      setRunsByDate(runs);
      setAssignmentsByDate(byDate);
    } catch {
      // Fail-soft: banner/strip simply show nothing rather than blocking the planner.
      setRunsByDate({});
      setAssignmentsByDate({});
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, dateKey, enabled]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { runsByDate, assignmentsByDate, loading, refetch };
}
