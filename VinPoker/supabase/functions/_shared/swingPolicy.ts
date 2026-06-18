// ════════════════════════════════════════════════════════════════════════════
// swingPolicy.ts — CANONICAL Dealer Swing timing / threshold / scoring constants.
//
// A1 of the Dealer Swing hardening roadmap: a single source of truth for the
// numbers that were previously scattered as magic literals + `?? N` fallbacks
// across pickNextDealer.ts, process-swing/index.ts, pass2-pre-assign.ts,
// fillEmptyTables.ts, mealBreakService.ts and computeSwingDuration.ts.
//
// ⚠️ A1 IS A PURE CONSOLIDATION — NO numeric value changes, NO logic/ordering
//    changes. Every value below is byte-identical to the literal it replaced;
//    the original site is cited in the trailing comment. swingPolicy.test.ts
//    asserts each value, so an accidental edit here fails the test.
//
// Notes on intentional duplicates (faithful to today's code; NOT bugs to fix in
// A1 — surfaced here for a later A2 reconciliation):
//   • defaultClubBreakDurationMinutes = 20 (pickNextDealer destructuring default
//     + restThreshold fallback) vs minBreakGuardFallbackMinutes = 15 (the raw
//     `options.clubBreakDurationMinutes ?? 15` at the on-break guard). Two
//     different break-minute fallbacks coexist today; both preserved verbatim.
//   • fatigueHardCapConsecutive (4) and softCapWarningConsecutive (4) are two
//     independent rules that happen to share the threshold — kept separate so
//     they do not become coupled.
// ════════════════════════════════════════════════════════════════════════════

export const SWING_POLICY = {
  // ── swing_config fallback defaults ────────────────────────────────────────
  defaults: {
    swingDurationMinutes: 30,     // index.ts DEFAULT_SWING_DURATION_MINUTES + Math.max(30, …)
    breakDurationMinutes: 15,     // index.ts DEFAULT_BREAK_DURATION_MINUTES; mealBreakService `?? 15`
    preAnnounceMinutes: 6,        // index.ts DEFAULT_PRE_ANNOUNCE_MINUTES
    syncWindowMinutes: 5,         // computeSwingDuration `sync_window_minutes ?? 5`
  },

  // ── pickNextDealer rest / cooldown guards ─────────────────────────────────
  rest: {
    minRestMinutes: 10,               // pickNextDealer default param
    minInterSwingRestMinutes: 10,     // pickNextDealer default param + fillEmptyTables `?? 10`
    hardRestFloorMinutes: 10,         // Math.max(minInterSwingRestMinutes, 10)
    poolCooldownMinutes: 1,           // pool cooldown guard
    predictiveHorizonMinutes: 15,     // reservation look-ahead: Date.now() + 15*60_000
    restEpsilonMinutes: 1 / 60,       // EPSILON_SEC = 1/60 min (1-second timing grace)
  },

  // ── priority-break + fatigue thresholds ───────────────────────────────────
  fatigue: {
    defaultClubBreakDurationMinutes: 20,  // pickNextDealer destructuring default + restThreshold base
    minBreakGuardFallbackMinutes: 15,     // on-break guard: options.clubBreakDurationMinutes ?? 15
    priorityBreakRestBufferMinutes: 5,    // restThreshold = (break ?? 20) + 5
    fatigueHardCapConsecutive: 4,         // fatigueHardCap = consecutive >= 4 && restMin < 10
    fatigueHardCapRestMinutes: 10,        // fatigueHardCap = consecutive >= 4 && restMin < 10
    softCapWarningConsecutive: 4,         // diagnostic_logs high_consecutive_warning at consecutive >= 4
    consecutivePenaltyThreshold: 3,       // consecutive_penalty + heavy_worker gate (consecutive >= 3)
  },

  // ── pre-assign window (pass2-pre-assign.ts) ───────────────────────────────
  preAssignWindow: {
    halfWidthMinutes: 2,                  // window = [now + (preAnnounce - 2), now + (preAnnounce + 2)]
    emergencyOtPreAnnounceMinutes: 3,     // EMERGENCY_OT_PRE_ANNOUNCE_MINUTES
  },

  // ── pickNextDealer scoring weights ────────────────────────────────────────
  scoring: {
    onBreakPenalty: -50,                  // on_break dealers deprioritized

    restBonusHighMinutes: 20, restBonusHigh: 200,   // restMin >= 20 → +200
    restBonusMidMinutes: 10,  restBonusMid: 100,    // restMin >= 10 → +100
    restBonusLowMinutes: 5,   restBonusLow: 50,     // restMin >= 5  → +50

    tierBonusHighA: 30,       // tourTier HIGH + tier A
    tierBonusHighB: 5,        // tourTier HIGH + tier B
    tierBonusMediumB: 20,     // tourTier MEDIUM + tier B
    tierBonusLowC: 20,        // tourTier LOW + tier C

    consecutivePenaltyPerSwing: -10,  // consecutive_penalty = -consecutive * 10 (consecutive >= 3)
    mixedBonus: 2,                    // skills includes "Mixed"
    skillBonusPerMatch: 20,           // +20 per matching required game type

    priorityBreakPenalty: -500,       // priority_break_flag set

    heavyWorkerPenaltyPerSwing: -10,  // heavy_worker = -10 * (consecutive - 2) (consecutive >= 3)
    heavyWorkerBaselineSwings: 2,     // the "- 2" baseline in (consecutive - 2)

    consecutiveHighPenalty: -20,      // HIGH→HIGH back-to-back tier

    backToBackSameTierPenalty: -50,   // same table + same tier
    backToBackDiffTierPenalty: -25,   // same table + different tier

    breakEquitySevereRatio: 0.7,  breakEquitySeverePenalty: -80,   // dealerRatio < avg * 0.7
    breakEquityModerateRatio: 0.9, breakEquityModeratePenalty: -30, // dealerRatio < avg * 0.9

    prioritySwingBonus: 300,          // table has priority_swing_at
    fatiguePenalty: -300,             // Level-3 emergency override (skipFatigueHardCap && fatigueHardCap)
  },
} as const;

export type SwingPolicy = typeof SWING_POLICY;
