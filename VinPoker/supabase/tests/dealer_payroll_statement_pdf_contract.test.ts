import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(new URL("../migrations/20270113000000_dealer_payroll_statement_pdf_storage.sql", import.meta.url));
const statementMigration = await Deno.readTextFile(new URL("../migrations/20270112000000_dealer_payroll_statements_v1.sql", import.meta.url));
const renderer = await Deno.readTextFile(new URL("../functions/render-payroll-statement/index.ts", import.meta.url));
const uiMigration = await Deno.readTextFile(new URL("../migrations/20270113000001_dealer_payroll_statement_ft_ui_contract.sql", import.meta.url));

Deno.test("PDF storage migration is additive and private", () => {
  assertStringIncludes(migration, "add column if not exists pdf_hash");
  assertStringIncludes(migration, "add column if not exists pdf_storage_path");
  assertStringIncludes(migration, "values ('payroll-statements', 'payroll-statements', false");
  assertStringIncludes(migration, "grant execute on function public.mark_dealer_payroll_statement_pdf_rendered");
  assert(!/grant\s+.*on\s+table\s+public\.dealer_payroll_statements\s+to\s+authenticated/i.test(migration));
  assert(!/drop\s+table|truncate\s+table/i.test(migration));
});

Deno.test("renderer is snapshot-only and does not accept client payroll data", () => {
  assertStringIncludes(renderer, 'rpc("get_dealer_payroll_statement"');
  assertStringIncludes(renderer, "renderPayrollStatementPdf(snapshot");
  assertStringIncludes(renderer, 'snapshot.club_id');
  assertStringIncludes(renderer, 'snapshot.statement_hash');
  assert(!renderer.includes("body.amount"));
  assert(!renderer.includes("body.club_name"));
  assert(!renderer.includes("body.dealer_name"));
  assert(!renderer.includes("body.logo_url"));
  assertStringIncludes(renderer, "upsert: false");
  assert(!renderer.includes("upsert: true"));
  assertStringIncludes(renderer, 'rpc("claim_dealer_payroll_statement_pdf"');
  assertStringIncludes(renderer, 'rpc("get_dealer_payroll_statement_rollout"');
  assert(renderer.indexOf('rpc("claim_dealer_payroll_statement_pdf"') < renderer.lastIndexOf("renderPayrollStatementPdf(snapshot"));
});

Deno.test("statement snapshot carries backend identity and versioned brand asset", () => {
  assertStringIncludes(statementMigration, "'full_name', v_dealer.full_name");
  assertStringIncludes(statementMigration, "'club_name', v_club.name");
  assertStringIncludes(statementMigration, "'brand_key', 'vinpoker'");
  assertStringIncludes(statementMigration, "'brand_asset_version', 'v1'");
});

Deno.test("FT UI contract is fail closed and exposes only guarded entrypoints", () => {
  assertStringIncludes(uiMigration, "dealer_payroll_statement_rollout");
  assert(/master_enabled\s+boolean not null default false/.test(uiMigration));
  assert(/allowed_club_ids\s+uuid\[\] not null default '\{\}'::uuid\[\]/.test(uiMigration));
  assertStringIncludes(uiMigration, "PAYROLL_STATEMENT_BUSINESS_CONFLICT");
  assertStringIncludes(uiMigration, "create unique index if not exists dealer_payroll_statements_active_ft_business_uq");
  assert(/revoke all on function public\.claim_dealer_payroll_statement_pdf\(uuid,\s*uuid\) from public, anon, authenticated/i.test(uiMigration));
  assert(!/grant\s+execute\s+on\s+function\s+public\.claim_dealer_payroll_statement_pdf[^;]+authenticated/i.test(uiMigration));
});
