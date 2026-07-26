import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migration00002 = (await Deno.readTextFile(
  new URL("../migrations/20270105000002_dealer_pt_wage_global_continuous_accrual.sql", import.meta.url),
)).replaceAll("\r\n", "\n");
const migration00003 = (await Deno.readTextFile(
  new URL("../migrations/20270105000003_dealer_pt_wage_rate_history.sql", import.meta.url),
)).replaceAll("\r\n", "\n");

Deno.test("00002 leaves the global mutation RPC ungranted until 00003", () => {
  assertStringIncludes(
    migration00002,
    "revoke all on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) from authenticated;",
  );
  assertEquals(
    /grant execute on function public\.set_all_approved_dealer_pt_wage_accrual\(boolean,text\) to authenticated/i
      .test(migration00002),
    false,
  );
  assertStringIncludes(
    migration00003,
    "grant execute on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) to authenticated;",
  );
});

Deno.test("00003 fails global enable closed until the complete payroll contract is ready", () => {
  for (const required of [
    "create or replace function public.assert_dealer_pt_wage_global_activation_ready",
    "public.dealer_pt_wage_rate_history",
    "accrual_policy_snapshot",
    "trg_capture_dealer_pt_wage_rate_history",
    "PT_WAGE_ACTIVATION_NOT_READY",
    "perform public.assert_dealer_pt_wage_global_activation_ready(v_effective_from);",
  ]) assertStringIncludes(migration00003, required);
  assert(/if p_standby_accrual_enabled then[\s\S]*assert_dealer_pt_wage_global_activation_ready/u.test(migration00003));
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
  ]) assertStringIncludes(migration00003, required);
  assertEquals(/v_amount_vnd := v_amount_vnd \+ v_segment_amount_vnd/u.test(migration00003), true);
  assertEquals(/v_amount_vnd := v_minutes \/ 60\.0 \* v_rate/u.test(migration00003), false);
});

Deno.test("rate baseline seed is replay-safe and never rewrites paid history", () => {
  assertStringIncludes(migration00003, "and not exists (");
  assertStringIncludes(migration00003, "and h.pt_eligible");
  assertEquals(/update\s+public\.dealer_pt_wage_payments\b/i.test(migration00003), false);
  assertStringIncludes(migration00003, "'rate_segments', coalesce(v_bal->'rate_segments', '[]'::jsonb)");
});
