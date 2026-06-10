/**
 * _shared/computeSwingDuration.ts
 *
 * Swing duration computation with:
 * - Corrected ratio direction (tight pool → SHORTER swings)
 * - Sync-swing mode for tournament tables (all tables swing together)
 * - Pool snapshot support for batch consistency
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwingDurationResult {
  durationMinutes: number;
  isDynamic: boolean;
  poolRatio: number;
  durationRationale: string;
}

export interface SwingDurationConfig {
  swing_duration_minutes: number;
  auto_adjust_duration: boolean;
  min_duration: number;
  max_duration?: number;
  /** If true, all due assignments swing simultaneously at the next sync boundary. */
  sync_swings?: boolean;
  /** Width of the sync window in minutes. Default: 5. */
  sync_window_minutes?: number;
}

export type SupabaseAdmin = any;

// ─── computeSwingDuration ─────────────────────────────────────────────────────

export async function computeSwingDuration(
  admin: SupabaseAdmin,
  clubId: string,
  config: SwingDurationConfig
): Promise<SwingDurationResult> {
  if (!config.auto_adjust_duration) {
    return {
      durationMinutes: config.swing_duration_minutes,
      isDynamic: false,
      poolRatio: 1,
      durationRationale: `fixed:${config.swing_duration_minutes}min`,
    };
  }

  // ── Corrected duration via SQL RPC ────────────────────────────────────────
  // The RPC calculate_dynamic_swing_duration uses:
  //   ratio = weighted_pool / active_tables
  //   factor = CLAMP(target_ratio / ratio, min_factor, max_factor)  ← CORRECTED direction
  //   duration = CLAMP(base / factor, min, max)
  // When ratio < target_ratio (tight pool): factor > 1 → duration SHORTER than base ✓
  // When ratio > target_ratio (generous pool): factor < 1 → duration LONGER than base ✓
  const rpcClient = admin as unknown as {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: number | null }>;
  };
  const { data: rpcResult } = await rpcClient.rpc("calculate_dynamic_swing_duration", {
    p_club_id: clubId,
    p_table_type: "tournament",
  });

  if (rpcResult == null) {
    // Fallback: compute inline with corrected formula
    const poolRatio = 1;
    const durationMinutes = config.swing_duration_minutes;
    return {
      durationMinutes,
      isDynamic: false,
      poolRatio,
      durationRationale: `rpc_fallback:${durationMinutes}min`,
    };
  }

  const durationMinutes = typeof rpcResult === "number" ? rpcResult : config.swing_duration_minutes;

  return {
    durationMinutes,
    isDynamic: true,
    poolRatio: 1,
    durationRationale: `dynamic:${durationMinutes}min|base:${config.swing_duration_minutes}min`,
  };
}

// ─── computeNextSwingAt ───────────────────────────────────────────────────────

/**
 * Compute the absolute time for the next swing, rounding to the nearest
 * sync boundary if sync_swings is enabled.
 *
 * Sync mode: all due tables in the sync_window swing at the same boundary,
 * producing a natural "wave" of swings visible to players + floor.
 *
 * Non-sync mode: each table gets its own swing_due_at (now + durationMinutes).
 */
export function computeNextSwingAt(
  durationMinutes: number,
  syncConfig?: { sync_swings: boolean; sync_window_minutes: number }
): string {
  const now = Date.now();

  if (syncConfig?.sync_swings) {
    // Round up to the next sync boundary
    const windowMs = (syncConfig.sync_window_minutes ?? 5) * 60_000;
    const nextBoundary = Math.ceil(now / windowMs) * windowMs;
    const durationMs = durationMinutes * 60_000;

    // Use max(boundary, now + duration) so the swing is at least
    // `durationMinutes` away AND aligned to the sync boundary.
    const target = Math.max(nextBoundary, now + durationMs);
    return new Date(target).toISOString();
  }

  return new Date(now + durationMinutes * 60_000).toISOString();
}
