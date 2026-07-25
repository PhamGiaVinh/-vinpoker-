import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL(
    "../migrations/20270105000001_dealer_pt_standby_accrual_policy.sql",
    import.meta.url,
  ),
);

Deno.test("PT standby accrual is default-off and only changes a server policy", () => {
  assertStringIncludes(
    migration,
    "standby_accrual_enabled  boolean not null default false",
  );
  assertStringIncludes(
    migration,
    "create or replace function public.set_dealer_pt_wage_accrual_policy",
  );
  assertStringIncludes(migration, "if v_actor is null then");
  assertStringIncludes(
    migration,
    "a reason of at most 500 characters is required",
  );
  assertStringIncludes(migration, "effective from cannot be in the future");
  assert(
    !/grant\s+(?:all|insert|update|delete)\s+on table public\.dealer_pt_wage_accrual_policies\s+to authenticated/i
      .test(migration),
  );
});

Deno.test("continuous standby accrual preserves the payout anchor and immutable history", () => {
  assertStringIncludes(migration, "max(covered_to)");
  assertStringIncludes(migration, "greatest(da.check_in_time, v_anchor");
  assertStringIncludes(
    migration,
    "add column if not exists accrual_policy_snapshot jsonb",
  );
  assertStringIncludes(
    migration,
    "'accrual_policy_snapshot', v_policy_snapshot",
  );
  assertEquals(
    /update\s+public\.dealer_pt_wage_payments\b/i.test(migration),
    false,
  );
});

Deno.test("legacy cap remains explicit while continuous mode removes only that cap", () => {
  assertStringIncludes(migration, "when v_standby_accrual_enabled then");
  assertStringIncludes(migration, "else\n               least(");
  assertStringIncludes(migration, "1440");
  assertStringIncludes(migration, "'current_shift_cap_reached'");
  assertStringIncludes(migration, "'live_accrual_active'");
});
