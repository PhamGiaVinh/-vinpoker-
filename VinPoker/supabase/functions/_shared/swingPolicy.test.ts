// Deno test — proves SWING_POLICY values are byte-identical to the literals they
// replaced in A1. If any value drifts, this test fails (A1 = pure consolidation,
// no numeric change). Run: `deno test swingPolicy.test.ts`
import { assertEquals } from "jsr:@std/assert@1";
import { SWING_POLICY as P } from "./swingPolicy.ts";

Deno.test("defaults (swing_config fallbacks) match original literals", () => {
  assertEquals(P.defaults.swingDurationMinutes, 30);   // index DEFAULT_SWING_DURATION_MINUTES + Math.max(30,…)
  assertEquals(P.defaults.breakDurationMinutes, 15);   // index DEFAULT_BREAK_DURATION_MINUTES; mealBreak ?? 15
  assertEquals(P.defaults.preAnnounceMinutes, 6);      // index DEFAULT_PRE_ANNOUNCE_MINUTES
  assertEquals(P.defaults.syncWindowMinutes, 5);       // computeSwingDuration ?? 5
});

Deno.test("rest / cooldown guards match original literals", () => {
  assertEquals(P.rest.minRestMinutes, 10);
  assertEquals(P.rest.minInterSwingRestMinutes, 10);
  assertEquals(P.rest.hardRestFloorMinutes, 10);       // Math.max(minInterSwingRest, 10)
  assertEquals(P.rest.executeMinRestFloorMinutes, 15); // execute gate == plan floor (raised 13→15, aligned 2026-07-06)
  assertEquals(P.rest.poolCooldownMinutes, 1);
  assertEquals(P.rest.predictiveHorizonMinutes, 15);   // Date.now() + 15*60_000
  assertEquals(P.rest.restEpsilonMinutes, 1 / 60);     // EPSILON_SEC = 1/60
});

Deno.test("fatigue / priority-break thresholds match original literals", () => {
  assertEquals(P.fatigue.defaultClubBreakDurationMinutes, 20);  // destructuring default + restThreshold base
  assertEquals(P.fatigue.minBreakGuardFallbackMinutes, 15);     // options.clubBreakDurationMinutes ?? 15
  assertEquals(P.fatigue.priorityBreakRestBufferMinutes, 5);    // restThreshold (break ?? 20) + 5
  assertEquals(P.fatigue.fatigueHardCapConsecutive, 4);         // consecutive >= 4
  assertEquals(P.fatigue.fatigueHardCapRestMinutes, 10);        // restMin < 10
  assertEquals(P.fatigue.softCapWarningConsecutive, 4);         // high_consecutive_warning at >= 4
  assertEquals(P.fatigue.consecutivePenaltyThreshold, 3);       // consecutive >= 3
});

Deno.test("pre-assign window match original literals", () => {
  assertEquals(P.preAssignWindow.halfWidthMinutes, 2);               // ±2
  assertEquals(P.preAssignWindow.emergencyOtPreAnnounceMinutes, 5);  // EMERGENCY_OT_PRE_ANNOUNCE_MINUTES (raised 3→5 on 2026-07-05)
});

Deno.test("scoring weights match original literals", () => {
  assertEquals(P.scoring.onBreakPenalty, -50);
  assertEquals(P.scoring.restBonusHighMinutes, 20);
  assertEquals(P.scoring.restBonusHigh, 200);
  assertEquals(P.scoring.restBonusMidMinutes, 10);
  assertEquals(P.scoring.restBonusMid, 100);
  assertEquals(P.scoring.restBonusLowMinutes, 5);
  assertEquals(P.scoring.restBonusLow, 50);
  assertEquals(P.scoring.tierBonusHighA, 30);
  assertEquals(P.scoring.tierBonusHighB, 5);
  assertEquals(P.scoring.tierBonusMediumB, 20);
  assertEquals(P.scoring.tierBonusLowC, 20);
  assertEquals(P.scoring.consecutivePenaltyPerSwing, -10);  // -consecutive * 10
  assertEquals(P.scoring.mixedBonus, 2);
  assertEquals(P.scoring.skillBonusPerMatch, 20);
  // priorityBreakPenalty removed in A2 (priority_break is now a hard gate, not a soft term).
  assertEquals(P.scoring.heavyWorkerPenaltyPerSwing, -10);  // -10 * (consecutive - 2)
  assertEquals(P.scoring.heavyWorkerBaselineSwings, 2);
  assertEquals(P.scoring.consecutiveHighPenalty, -20);
  assertEquals(P.scoring.backToBackSameTierPenalty, -50);
  assertEquals(P.scoring.backToBackDiffTierPenalty, -25);
  assertEquals(P.scoring.breakEquitySevereRatio, 0.7);
  assertEquals(P.scoring.breakEquitySeverePenalty, -80);
  assertEquals(P.scoring.breakEquityModerateRatio, 0.9);
  assertEquals(P.scoring.breakEquityModeratePenalty, -30);
  assertEquals(P.scoring.prioritySwingBonus, 300);
  assertEquals(P.scoring.fatiguePenalty, -300);
});
