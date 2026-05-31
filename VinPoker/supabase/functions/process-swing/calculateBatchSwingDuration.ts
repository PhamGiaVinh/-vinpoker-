/**
 * calculateBatchSwingDuration.ts
 *
 * Computes a SINGLE swing duration for a batch of assignments,
 * using a pool snapshot taken BEFORE the batch (TOCTOU-safe).
 *
 * This is the APPLICATION-LEVEL equivalent of calculate_dynamic_swing_duration
 * (the SQL RPC) that fixes the per-row trigger anti-pattern.
 *
 * ── Problem ─────────────────────────────────────────────────────────────────
 * The SQL RPC calculate_dynamic_swing_duration() queries CURRENT live state.
 * When called per-row via a trigger during batch INSERT (Pass 1 fillEmptyTables),
 * each INSERT sees the pool SHRINKING (one fewer available dealer after each
 * assignment). This produces different durations across the same batch.
 *
 * ── Fix ─────────────────────────────────────────────────────────────────────
 * Take ONE pool snapshot before the batch, compute ONE duration, pass it as
 * swing_due_at to every RPC call. All assignments in the batch get the same
 * swing_due_at regardless of insertion order.
 *
 * ── Formula (mirrors SQL) ──────────────────────────────────────────────────
 * ratio = weighted_pool / active_tables
 * factor = CLAMP(ratio / target_ratio, base/max, base/min)
 * duration = base / factor
 * result = CLAMP(duration, min, max)
 */

export interface PoolSnapshot {
  active_tables: number;
  available: number;
  pre_assigned: number;
  weighted_pool: number;
}

export interface SwingConfig {
  swing_duration_minutes: number;
  auto_adjust_duration: boolean;
  base_duration_minutes: number;
  target_ratio: number;
  min_duration_minutes: number;
  max_duration_minutes: number;
}

export interface BatchSwingDurationResult {
  /** The computed swing duration in minutes */
  durationMinutes: number;
  /** The pool snapshot used for computation */
  poolSnapshot: PoolSnapshot;
  /** Human-readable rationale for logging/debugging */
  rationale: string;
  /** ISO timestamp: now + durationMinutes */
  swingDueAt: string;
}

const DEFAULT_CONFIG: SwingConfig = {
  swing_duration_minutes: 45,
  auto_adjust_duration: false,
  base_duration_minutes: 40,
  target_ratio: 1.43,
  min_duration_minutes: 30,
  max_duration_minutes: 50,
};

/**
 * Resolve effective SwingConfig from partial config, filling defaults.
 */
export function resolveSwingConfig(partial: Partial<SwingConfig>): SwingConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

/**
 * Calculate a single batch swing duration from pool snapshot + config.
 *
 * @param cfg      - Swing configuration (club-specific)
 * @param snapshot - Pool snapshot taken BEFORE the batch
 * @returns        - Computed duration, rationale, and swingDueAt ISO string
 */
export function calculateBatchSwingDuration(
  cfg: SwingConfig,
  snapshot: PoolSnapshot
): BatchSwingDurationResult {
  // Fixed duration (no auto-adjust): use configured swing_duration_minutes
  if (!cfg.auto_adjust_duration) {
    const swingDueAt = new Date(Date.now() + cfg.swing_duration_minutes * 60_000).toISOString();
    return {
      durationMinutes: cfg.swing_duration_minutes,
      poolSnapshot: snapshot,
      rationale: `fixed:${cfg.swing_duration_minutes}min`,
      swingDueAt,
    };
  }

  const activeTables = snapshot.active_tables;
  const weightedPool = snapshot.weighted_pool;

  // Edge case: no active tables → use base duration
  if (activeTables === 0) {
    const swingDueAt = new Date(Date.now() + cfg.base_duration_minutes * 60_000).toISOString();
    return {
      durationMinutes: cfg.base_duration_minutes,
      poolSnapshot: snapshot,
      rationale: `no_active_tables:${cfg.base_duration_minutes}min`,
      swingDueAt,
    };
  }

  // Edge case: empty pool → use max duration (longest wait for next dealer)
  if (weightedPool === 0) {
    const swingDueAt = new Date(Date.now() + cfg.max_duration_minutes * 60_000).toISOString();
    return {
      durationMinutes: cfg.max_duration_minutes,
      poolSnapshot: snapshot,
      rationale: `empty_pool_max:${cfg.max_duration_minutes}min`,
      swingDueAt,
    };
  }

  // Core formula (CORRECTED direction)
  // When ratio < target_ratio (tight pool): target_ratio/ratio > 1 → factor clamped to maxFactor
  //   → duration = base / maxFactor = base / (base/min) = MIN duration (shorter swings) ✓
  // When ratio > target_ratio (generous pool): target_ratio/ratio < 1 → factor clamped to minFactor
  //   → duration = base / minFactor = base / (base/max) = MAX duration (longer swings) ✓
  const ratio = weightedPool / activeTables;
  const rawFactor = ratio > 0 ? cfg.target_ratio / ratio : cfg.max_duration_minutes;
  const minFactor = cfg.base_duration_minutes / cfg.max_duration_minutes;
  const maxFactor = cfg.base_duration_minutes / cfg.min_duration_minutes;
  const factor = Math.min(Math.max(rawFactor, minFactor), maxFactor);
  const rawDuration = cfg.base_duration_minutes / factor;
  const durationMinutes = Math.round(
    Math.min(Math.max(rawDuration, cfg.min_duration_minutes), cfg.max_duration_minutes)
  );

  const swingDueAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();

  return {
    durationMinutes,
    poolSnapshot: snapshot,
    rationale: `dynamic:${durationMinutes}min|ratio:${ratio.toFixed(3)}|pool:${weightedPool}|tables:${activeTables}`,
    swingDueAt,
  };
}

/**
 * Re-compute swingDueAt at a later time using the same duration.
 * Useful for Pass 3 (swing execution) where we want the same duration
 * but a fresh `now + duration` timestamp.
 */
export function recomputeSwingDueAt(durationMinutes: number): string {
  return new Date(Date.now() + durationMinutes * 60_000).toISOString();
}
