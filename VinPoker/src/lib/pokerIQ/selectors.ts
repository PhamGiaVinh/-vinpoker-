// Selectors: weakest category, recommended drill, suggested event type.
import {
  Archetype,
  CategoryScore,
  DrillCategory,
  SuggestedEvent,
  SuggestedEventType,
} from "./types";

/** Lowest-scoring category (ties resolved by DRILL_CATEGORIES order via stable sort). */
export function weakestCategory(cs: CategoryScore[]): DrillCategory {
  return [...cs].sort((a, b) => a.score - b.score)[0]?.category ?? "vs_aggro";
}

const FIT_BY_ARCHETYPE: Record<Archetype, SuggestedEventType> = {
  tight_solid: "deepstack_mid_field",
  aggressive_builder: "deepstack_mid_field",
  final_table_hunter: "slow_structure",
  high_variance_attacker: "turbo_short_stack",
  passive_caller: "deepstack_small_field",
  bubble_survivor: "slow_structure",
  rising_grinder: "deepstack_mid_field",
  short_stack_specialist: "turbo_short_stack",
};

const AVOID_BY_WEAKEST: Record<DrillCategory, SuggestedEventType> = {
  preflop_discipline: "turbo_short_stack",
  position_steal: "turbo_short_stack",
  vs_aggro: "turbo_short_stack",
  vs_nit_passive: "deepstack_small_field",
  tournament_pressure: "turbo_short_stack",
};

export function suggestedEvent(archetype: Archetype, weakest: DrillCategory): SuggestedEvent {
  let fit = FIT_BY_ARCHETYPE[archetype];
  let avoid = AVOID_BY_WEAKEST[weakest];
  // Never recommend the exact event type we're also telling them to avoid.
  if (fit === avoid) fit = "slow_structure";
  return { fit, avoid };
}
