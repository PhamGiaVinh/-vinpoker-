import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildMockScenario,
  generateDailyDraft,
  type MockScenario,
} from "@/lib/shiftPlanner";
import type {
  AvailabilityRequest,
  DealerTier,
  GenerateDailyDraftResult,
  SchedulerConfig,
  SchedulerDealer,
  ShiftPlannerDataSource,
  ShiftTemplate,
} from "@/types/shiftPlanner";

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
  /** Phase 1 default: 'mock' (in-memory, no DB). 'live' reads dealers/dealer_skills. */
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

function normaliseTier(raw: string | null | undefined): DealerTier {
  const t = (raw ?? "").toUpperCase();
  return t === "A" || t === "B" || t === "C" ? (t as DealerTier) : "C";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Dealer Shift Planner data hook.
 *
 * Phase 1 (default `mock`): runs the pure scheduler over an in-memory scenario so
 * the planner UI is fully demoable with no database and no migration applied.
 *
 * Phase 2 (`live`, owner-gated): reads `dealers` + `dealer_skills` (READ ONLY —
 * never the Dealer Swing / attendance / rotation tables), projects them into
 * `SchedulerDealer`, and runs the same pure core. Shift templates / availability
 * / weekly aggregates come from the additive `dealer_shift_*` tables once they
 * exist; until then live mode falls back to the mock templates/requirements.
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

    // ── live mode (Phase 2) ──
    setLoading(true);
    try {
      const { data: dealerRows, error: dealerErr } = await supabase
        .from("dealers")
        .select("id, club_id, full_name, tier, status, skills")
        .in("club_id", clubIds)
        .is("deleted_at", null)
        .order("full_name");
      if (dealerErr) throw dealerErr;

      const { data: skillRows, error: skillErr } = await supabase
        .from("dealer_skills")
        .select("dealer_id, game_type");
      if (skillErr) throw skillErr;

      const skillsByDealer = new Map<string, string[]>();
      for (const s of skillRows ?? []) {
        const list = skillsByDealer.get(s.dealer_id) ?? [];
        list.push(s.game_type);
        skillsByDealer.set(s.dealer_id, list);
      }

      // Shift templates / availability / weekly aggregates live in the additive
      // dealer_shift_* tables (Phase 2). Until applied, reuse the mock day shape.
      const fallback = buildMockScenario(workDate);

      const dealers: SchedulerDealer[] = (dealerRows ?? []).map((d) => {
        const tier = normaliseTier(d.tier);
        const merged = new Set<string>([...(d.skills ?? []), ...(skillsByDealer.get(d.id) ?? [])]);
        return {
          id: d.id,
          clubId: d.club_id,
          fullName: d.full_name,
          tier,
          isLead: tier === "A",
          status: d.status ?? "active",
          skills: [...merged],
          assignedHoursThisWeek: 0,
          maxHoursPerWeek: fallback.config.weeklyMaxHours,
          weeklyTargetHours: fallback.config.weeklyTargetHours,
          nightShiftsThisWeek: 0,
          preferredStartHours: {},
          lastShiftEndAt: null,
        };
      });

      const scenario: MockScenario = {
        clubId: clubIds[0] ?? fallback.clubId,
        dealers: dealers.length > 0 ? dealers : fallback.dealers,
        templates: fallback.templates,
        availability: [],
        config: fallback.config,
      };
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
