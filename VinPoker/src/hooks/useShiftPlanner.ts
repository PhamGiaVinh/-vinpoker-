import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildLiveScenario,
  buildMockScenario,
  generateDailyDraft,
  localWeekBounds,
  type MockScenario,
} from "@/lib/shiftPlanner";
import type {
  AvailabilityRequest,
  GenerateDailyDraftResult,
  SchedulerConfig,
  SchedulerDealer,
  ShiftPlannerDataSource,
  ShiftTemplate,
} from "@/types/shiftPlanner";

// Club-local timezone (VN = UTC+7). Could become per-club config later.
const CLUB_TZ_OFFSET_MINUTES = 420;
const DAY_MS = 86_400_000;

// ── Hook contract ─────────────────────────────────────────────────────────────

export interface ShiftPlannerData {
  workDate: string;
  clubId: string;
  dealers: SchedulerDealer[];
  templates: ShiftTemplate[];
  availability: AvailabilityRequest[];
  config: SchedulerConfig;
  draft: GenerateDailyDraftResult;
}

export interface UseShiftPlannerArgs {
  clubIds: string[];
  workDate: string; // YYYY-MM-DD
  /** Phase 1 default: 'mock' (in-memory, no DB). 'live' reads the dealer_shift_* tables. */
  mode?: ShiftPlannerDataSource;
}

export interface UseShiftPlannerResult {
  data: ShiftPlannerData | null;
  loading: boolean;
  error: string | null;
  source: ShiftPlannerDataSource;
  /** Re-run the auto-fill (recompute the draft from current inputs). */
  regenerate: () => void;
  /** Re-pull inputs (live mode) / rebuild scenario (mock mode). */
  refetch: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function scenarioToData(scenario: MockScenario, workDate: string): ShiftPlannerData {
  return {
    workDate,
    clubId: scenario.clubId,
    dealers: scenario.dealers,
    templates: scenario.templates,
    availability: scenario.availability,
    config: scenario.config,
    draft: generateDailyDraft({
      workDate,
      clubId: scenario.clubId,
      dealers: scenario.dealers,
      templates: scenario.templates,
      availability: scenario.availability,
      config: scenario.config,
    }),
  };
}

// dealer_shift_* tables are not yet in the generated types (migration owner-gated),
// so reads go through an untyped client — same pattern as useDealerScores.
const db = supabase as unknown as {
  from: (table: string) => any;
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Dealer Shift Planner data hook.
 *
 * Phase 1 (default `mock`): runs the pure scheduler over an in-memory scenario so
 * the planner UI is demoable with no database.
 *
 * Phase 2 (`live`): reads dealers + dealer_skills + dealer_shift_templates +
 * dealer_availability_requests (for the work date) + dealer_shift_assignments
 * (week window, for overlap aggregates), maps them via the pure `buildLiveScenario`
 * adapter, and runs the same pure core. READ ONLY — never the Dealer Swing /
 * attendance / rotation / payroll tables.
 */
export function useShiftPlanner({
  clubIds,
  workDate,
  mode = "mock",
}: UseShiftPlannerArgs): UseShiftPlannerResult {
  const [data, setData] = useState<ShiftPlannerData | null>(null);
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const clubKey = useMemo(() => [...clubIds].sort().join(","), [clubIds]);

  const load = useCallback(async () => {
    if (mode === "mock") {
      setData(scenarioToData(buildMockScenario(workDate), workDate));
      setLoading(false);
      setError(null);
      return;
    }

    // ── live mode ──
    setLoading(true);
    try {
      if (clubIds.length === 0) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }

      const { startMs, endMs } = localWeekBounds(workDate, CLUB_TZ_OFFSET_MINUTES);
      const weekLowIso = new Date(startMs - DAY_MS).toISOString(); // -1 day catches straddling shifts
      const weekHighIso = new Date(endMs).toISOString();

      const [dealersRes, skillsRes, templatesRes, availabilityRes, assignmentsRes] = await Promise.all([
        db.from("dealers")
          .select("id, club_id, full_name, tier, status, skills")
          .in("club_id", clubIds)
          .is("deleted_at", null)
          .order("full_name"),
        db.from("dealer_skills").select("dealer_id, game_type"),
        db.from("dealer_shift_templates")
          .select("id, club_id, label, scheduled_start_at, scheduled_end_at, default_hours, required_skills, needs_lead, need_count")
          .in("club_id", clubIds)
          .eq("active", true),
        db.from("dealer_availability_requests")
          .select("dealer_id, work_date, kind, template_id, note")
          .in("club_id", clubIds)
          .eq("work_date", workDate),
        db.from("dealer_shift_assignments")
          .select("dealer_id, scheduled_start_at, scheduled_end_at, status")
          .in("club_id", clubIds)
          .gte("scheduled_start_at", weekLowIso)
          .lt("scheduled_start_at", weekHighIso),
      ]);

      for (const res of [dealersRes, skillsRes, templatesRes, availabilityRes, assignmentsRes]) {
        if (res.error) throw res.error;
      }

      const scenario = buildLiveScenario({
        clubId: clubIds[0],
        workDate,
        tzOffsetMinutes: CLUB_TZ_OFFSET_MINUTES,
        dealerRows: dealersRes.data ?? [],
        skillRows: skillsRes.data ?? [],
        templateRows: templatesRes.data ?? [],
        availabilityRows: availabilityRes.data ?? [],
        weekAssignmentRows: (assignmentsRes.data ?? [])
          .filter((a: any) => a.status !== "cancelled" && a.status !== "no_show")
          .map((a: any) => ({
            dealerId: a.dealer_id,
            scheduledStartAt: a.scheduled_start_at,
            scheduledEndAt: a.scheduled_end_at,
          })),
      });

      setData(scenarioToData(scenario, workDate));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu xếp lịch");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workDate, clubKey]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, nonce]);

  const regenerate = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, source: mode, regenerate, refetch: regenerate };
}
