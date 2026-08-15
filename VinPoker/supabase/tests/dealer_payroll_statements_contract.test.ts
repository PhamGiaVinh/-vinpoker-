import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migration = (await Deno.readTextFile(
  new URL(
    "../migrations/20270112000000_dealer_payroll_statements_v1.sql",
    import.meta.url,
  ),
)).replaceAll("\r\n", "\n");

function functionBody(name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = migration.indexOf(marker);
  assert(start >= 0, `missing function ${name}`);
  const end = migration.indexOf("\n$$;", start);
  assert(end >= 0, `unterminated function ${name}`);
  return migration.slice(start, end + 4);
}

Deno.test("payroll statement contract keeps financial snapshots server-authoritative", () => {
  assertStringIncludes(migration, "create table if not exists public.dealer_payroll_statements");
  assertStringIncludes(migration, "create table if not exists public.dealer_payroll_statement_lines");
  assertStringIncludes(migration, "create table if not exists public.dealer_pt_wage_settlements");
  assertStringIncludes(migration, "source_fingerprint");
  assertStringIncludes(migration, "statement_hash");
  assertStringIncludes(migration, "brand_asset_version");
  assertStringIncludes(migration, "to_regclass('public.payment_records') is null");
  assertStringIncludes(migration, "to_regclass('public.club_cashiers') is null");
  assertStringIncludes(migration, "to_regclass('public.dealer_attendance') is null");
  assertStringIncludes(migration, "PAYROLL_STATEMENT_PERIOD_NOT_LOCKED");
  assert(!/calculate_dealer_payroll\s*\(/i.test(functionBody("finalize_full_time_payroll_statement")));
});

Deno.test("PT settlement holds a frozen server cutoff and payment never recalculates it", () => {
  const finalize = functionBody("finalize_part_time_payroll_statement");
  const payout = functionBody("pay_finalized_part_time_payroll_statement");
  const legacyPayout = functionBody("pay_part_time_balance");

  assertStringIncludes(finalize, "pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:'");
  assertStringIncludes(finalize, "pg_advisory_xact_lock(hashtext('pt_wage:'");
  assertStringIncludes(finalize, "v_cutoff := nullif(v_balance->>'as_of', '')::timestamptz");
  assertStringIncludes(finalize, "dealer_pt_wage_settlements");
  assert(!/_pt_wage_balance\s*\(/i.test(payout));
  assertStringIncludes(payout, "v_settlement.amount_vnd");
  assertStringIncludes(legacyPayout, "PT_FINALIZED_STATEMENT_PENDING_PAYMENT");
});

Deno.test("statement and payment records reject mutation instead of rewriting historical values", () => {
  assertStringIncludes(migration, "PAYROLL_STATEMENT_IMMUTABLE");
  assertStringIncludes(migration, "PAYROLL_STATEMENT_LINE_IMMUTABLE");
  assertStringIncludes(migration, "PT_WAGE_SETTLEMENT_IMMUTABLE");
  assertStringIncludes(migration, "PT_WAGE_PAYMENT_IMMUTABLE");
  assertStringIncludes(migration, "state = 'replaced'");
  assertStringIncludes(migration, "old.state = 'finalized' and new.state = 'pdf_rendered'");
  assertStringIncludes(migration, "old.state in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')");
  assertEquals(/grant\s+(?:insert|update|delete|all)\s+on table public\.dealer_payroll_statements\s+to authenticated/i.test(migration), false);
});
