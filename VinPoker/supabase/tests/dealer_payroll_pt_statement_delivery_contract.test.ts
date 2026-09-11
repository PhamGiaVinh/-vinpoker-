import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL(
    "../pending-migrations/20270114000004_dealer_payroll_pt_statement_delivery.sql",
    import.meta.url,
  ),
);
const renderer = await Deno.readTextFile(
  new URL("../functions/render-payroll-statement/index.ts", import.meta.url),
);
const frontend = await Deno.readTextFile(
  new URL("../../src/hooks/usePtPayrollStatements.ts", import.meta.url),
);

Deno.test("PT statements are linked to one locked period without repricing money", () => {
  assertStringIncludes(migration, "dealer_payroll_statement_period_links");
  assertStringIncludes(
    migration,
    "unique (club_id, payroll_period_id, dealer_id)",
  );
  assertStringIncludes(migration, "if v_period.status <> 'locked'");
  assertStringIncludes(
    migration,
    "v_preview := public._build_part_time_payroll_statement_preview(",
  );
  assertStringIncludes(migration, "'brand_asset_hash'");
  assertStringIncludes(migration, "insert into public.dealer_pt_wage_settlements");
  assertStringIncludes(migration, "PT_FINALIZED_STATEMENT_PENDING_PAYMENT");
  assert(!migration.includes("v_result := public.finalize_part_time_payroll_statement("));
  assert(!migration.includes("pay_finalized_part_time_payroll_statement("));
  assert(!migration.includes("pay_part_time_balance("));
});

Deno.test("PT preview and finalization remain server authoritative", () => {
  assertStringIncludes(migration, "preview_part_time_payroll_statement");
  assertStringIncludes(migration, "public._pt_wage_balance(p_dealer_id)");
  assertStringIncludes(
    migration,
    "public._assert_dealer_payroll_statement_rollout(p_club_id)",
  );
  assertStringIncludes(
    migration,
    "public._assert_dealer_payroll_statement_finalizer(p_club_id)",
  );
  assertStringIncludes(migration, "perform pg_advisory_xact_lock");
  assertStringIncludes(migration, "order by d.id");
  assert(!frontend.includes("net_pay_vnd:"));
  assert(!frontend.includes("balance_vnd:"));
});

Deno.test("ACL keeps internal linkage private and anon cannot finalize", () => {
  assertStringIncludes(migration, "force row level security");
  assertStringIncludes(
    migration,
    "revoke all on table public.dealer_payroll_statement_period_links from public, anon, authenticated",
  );
  assertStringIncludes(
    migration,
    "revoke all on function public._build_part_time_payroll_statement_preview(uuid,uuid,uuid) from public, anon, authenticated",
  );
  assertStringIncludes(
    migration,
    "revoke all on function public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text) from public, anon",
  );
  assertStringIncludes(
    migration,
    "has_function_privilege('anon', 'public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE')",
  );
});

Deno.test("mixed delivery operation adds only immutable PDF-ready PT statements", () => {
  assertStringIncludes(
    migration,
    "create_dealer_payroll_statement_delivery_operation_v2",
  );
  assertStringIncludes(migration, "s.statement_kind = 'part_time_settlement'");
  assertStringIncludes(
    migration,
    "s.state in ('pdf_rendered', 'delivery_failed')",
  );
  assertStringIncludes(migration, "v_target.pdf_status <> 'ready'");
  assertStringIncludes(migration, "PAYROLL_DELIVERY_TELEGRAM_UNLINKED");
  assertStringIncludes(migration, "PAYROLL_DELIVERY_ALREADY_ACTIVE");
  assertStringIncludes(migration, "for update of s");
});

Deno.test("renderer accepts PT identifier intents but never client amounts", () => {
  assertStringIncludes(renderer, 'parsed.mode === "preview_pt"');
  assertStringIncludes(renderer, '"preview_part_time_payroll_statement"');
  assertStringIncludes(renderer, 'parsed.mode === "preview_pt_view"');
  assertEquals(
    /body\.(amount|net_pay|balance|telegram_user_id)/.test(renderer),
    false,
  );
});
