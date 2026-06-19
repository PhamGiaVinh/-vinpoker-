/**
 * _shared/dealer-utils.ts  — FIXED VERSION (single source of truth)
 *
 * This file is now a thin re-export hub. Logic lives in:
 *   - pickNextDealer.ts    — dealer scoring, selection, game-type matching
 *   - fillEmptyTables.ts   — auto-fill tables with no dealer
 *   - evaluateBreakNeed.ts — 5-rule break decision tree + deadlock guard
 *   - computeSwingDuration.ts — swing duration with corrected ratio + sync mode
 *
 * IMPORTANT: Delete deploy-package/shared/dealer-utils.ts (575-line old copy).
 *            All edge functions must import from functions/_shared/dealer-utils.ts
 */

export {
  pickNextDealer,
  pickTopDealers,
  pickTopDealersWithDiagnostics,
  buildScoreLabel,
  buildDealerCandidates,
} from "./pickNextDealer.ts";

export {
  fillEmptyTables,
  type FillResult,
} from "./fillEmptyTables.ts";

export {
  evaluateBreakNeed,
  type BreakDecision,
} from "./evaluateBreakNeed.ts";

export {
  computeSwingDuration,
  computeNextSwingAt,
  type SwingDurationResult,
} from "./computeSwingDuration.ts";

// ─── Re-export types ──────────────────────────────────────────────────────────

export type {
  ScoreBreakdown,
  PickDealerOptions,
  DealerCandidate,
  BuildCandidatesResult,
  PickDiagnostics,
} from "./pickNextDealer.ts";

export type {
  SwingDurationConfig,
} from "./computeSwingDuration.ts";

export type {
  BreakEvalOptions,
} from "./evaluateBreakNeed.ts";

export {
  solveGreedyLazy,
  type SolverOptions,
} from "./rotationSolver.ts";

export type {
  RotationTable,
  RotationCandidate,
  RotationPair,
  RotationResult,
  MissedTableReason,
  Pass15Options,
  Pass15Result,
  ScoreCandidateInput,
  ScoreCandidateOptions,
  RotationTier,
} from "./rotationTypes.ts";

// ─── Shared utilities (not extracted) ─────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SupabaseAdmin = any;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

// ─── getTableIdsForClub ──────────────────────────────────────────────────────

export async function getTableIdsForClub(
  admin: SupabaseAdmin,
  clubId: string
): Promise<string[]> {
  const { data } = await admin
    .from("game_tables")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  return (data ?? []).map((t: { id: string }) => t.id);
}
