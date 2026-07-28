import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migrationV2 = (await Deno.readTextFile(
  new URL("../migrations/20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql", import.meta.url),
)).replaceAll("\r\n", "\n");

Deno.test("v2 keeps global mutation ungranted until readiness exists in the same transaction", () => {
  const readinessCall = migrationV2.indexOf("perform public.assert_dealer_pt_wage_global_activation_ready(v_effective_from);");
  const authenticatedGrant = migrationV2.lastIndexOf(
    "grant execute on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) to authenticated;",
  );

  assertStringIncludes(migrationV2, "SUPERSEDES WITHOUT REPLAY:");
  assertStringIncludes(
    migrationV2,
    "revoke all on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) from authenticated;",
  );
  assert(readinessCall >= 0);
  assert(authenticatedGrant > readinessCall);
  assertEquals((migrationV2.match(/^begin;$/gmu) ?? []).length, 1);
  assertEquals((migrationV2.match(/^commit;$/gmu) ?? []).length, 1);
});

Deno.test("v2 fails global enable closed until the complete payroll contract is ready", () => {
  for (const required of [
    "create or replace function public.assert_dealer_pt_wage_global_activation_ready",
    "public.dealer_pt_wage_rate_history",
    "accrual_policy_snapshot",
    "trg_capture_dealer_pt_wage_rate_history",
    "PT_WAGE_ACTIVATION_NOT_READY",
    "perform public.assert_dealer_pt_wage_global_activation_ready(v_effective_from);",
  ]) assertStringIncludes(migrationV2, required);
  assert(/if p_standby_accrual_enabled then[\s\S]*assert_dealer_pt_wage_global_activation_ready/u.test(migrationV2));
});

Deno.test("effective-dated rate and employment segments drive both wage modes", () => {
  for (const required of [
    "pt_eligible       boolean not null default true",
    "old.employment_type is distinct from new.employment_type",
    "v_segment_seconds",
    "v_cap_seconds             numeric := 1440 * 60",
    "if not v_standby_accrual_enabled then",
    "'segment_start', v_segment_start",
    "'segment_end', v_segment_end",
    "'elapsed_seconds', v_segment_seconds",
    "'amount_vnd', v_segment_amount_vnd",
  ]) assertStringIncludes(migrationV2, required);
  assertEquals(/v_amount_vnd := v_amount_vnd \+ v_segment_amount_vnd/u.test(migrationV2), true);
  assertEquals(/v_amount_vnd := v_minutes \/ 60\.0 \* v_rate/u.test(migrationV2), false);
});

Deno.test("rate baseline seed is replay-safe and never rewrites paid history", () => {
  assertStringIncludes(migrationV2, "and not exists (");
  assertStringIncludes(migrationV2, "and h.pt_eligible");
  assertEquals(/update\s+public\.dealer_pt_wage_payments\b/i.test(migrationV2), false);
  assertStringIncludes(migrationV2, "'rate_segments', coalesce(v_bal->'rate_segments', '[]'::jsonb)");
});
