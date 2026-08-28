import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(new URL("../migrations/20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair.sql", import.meta.url));
const edge = await Deno.readTextFile(new URL("../functions/send-payroll-statement/index.ts", import.meta.url));
const config = await Deno.readTextFile(new URL("../config.toml", import.meta.url));
const disposableScript = await Deno.readTextFile(new URL("../../scripts/deploy/test-dealer-pt-wage-disposable.ps1", import.meta.url));
const disposableBootstrap = await Deno.readTextFile(new URL("../../scripts/deploy/disposable-public-schema-bootstrap.sql", import.meta.url));
const lifecycleSql = await Deno.readTextFile(new URL("dealer_payroll_statement_ft_ui.sql", import.meta.url));

Deno.test("delivery contract is dark by default and requires the statement rollout", () => {
  assertStringIncludes(migration, "PAYROLL_DELIVERY_PARTIAL_DRIFT");
  assertStringIncludes(migration, "dealer_payroll_statement_delivery_rollout");
  assert(/master_enabled\s+boolean not null default false/.test(migration));
  assert(/allowed_club_ids\s+uuid\[\] not null default '\{\}'::uuid\[\]/.test(migration));
  assertStringIncludes(migration, "_dealer_payroll_statement_rollout_allowed(p_club_id)");
  assertStringIncludes(migration, "PAYROLL_DELIVERY_ROLLOUT_DISABLED");
  assertStringIncludes(migration, "_assert_dealer_payroll_statement_finalizer(p_club_id)");
  assert(!/grant\s+execute\s+on\s+function\s+public\.claim_dealer_payroll_statement_delivery_target[^;]+authenticated/i.test(migration));
  assertStringIncludes(migration, "grant execute on function public.claim_dealer_payroll_statement_delivery_target(uuid) to service_role");
});

Deno.test("disposable service worker preserves Supabase RLS authority", () => {
  assertStringIncludes(disposableBootstrap, "ALTER ROLE service_role BYPASSRLS");
});

Deno.test("delivery is operation-idempotent and has a per-statement send guard", () => {
  assertStringIncludes(migration, "unique (club_id, request_id)");
  assertStringIncludes(migration, "dealer_payroll_delivery_operations_active_club_period_uq");
  assertStringIncludes(migration, "dealer_payroll_delivery_targets_active_statement_channel_uq");
  assertStringIncludes(migration, "where delivery_state in ('pending', 'sending', 'sent', 'unknown')");
  assertStringIncludes(migration, "for update skip locked");
  assertStringIncludes(migration, "PAYROLL_DELIVERY_CLAIM_CONFLICT");
  assertStringIncludes(migration, "TELEGRAM_DISPATCH_UNCONFIRMED");
  assertStringIncludes(migration, "'unknown', t.provider_code");
});

Deno.test("Edge resolves destination and immutable PDF server-side", () => {
  assertStringIncludes(edge, '"get_dealer_payroll_statement_delivery_operation"');
  assertStringIncludes(edge, '"claim_dealer_payroll_statement_delivery_target"');
  assertStringIncludes(edge, '"_assert_dealer_payroll_statement_delivery_rollout"');
  assertStringIncludes(edge, ".select(\"telegram_user_id\")");
  assertStringIncludes(edge, "/sendDocument");
  assertStringIncludes(edge, "storage.from(BUCKET).download(storagePath)");
  assertStringIncludes(edge, 'p_pdf_hash: expectedHash');
  assertStringIncludes(edge, '"TELEGRAM_RECEIPT_UNCONFIRMED"');
  assert(!edge.includes("body.chat_id"));
  assert(!edge.includes("body.amount"));
  assert(!edge.includes("body.pdf"));
  assert(!edge.includes("telegram-swing-notifier"));
  assert(!/console\.(?:log|info|warn|error)\([^)]*chatId/.test(edge));
  assert(!/console\.(?:log|info|warn|error)\([^)]*botToken/.test(edge));
});

Deno.test("function remains JWT-protected", () => {
  assertStringIncludes(config, "[functions.send-payroll-statement]");
  assertStringIncludes(config, "verify_jwt = true");
});

Deno.test("PG16/17 disposable proof applies the delivery migration twice before SQL lifecycle tests", () => {
  assertStringIncludes(disposableScript, "20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair.sql");
  const firstApply = disposableScript.indexOf("Invoke-ContainerPsql '/tmp/payroll-telegram-delivery.sql'");
  const secondApply = disposableScript.indexOf("Invoke-ContainerPsql '/tmp/payroll-telegram-delivery.sql'", firstApply + 1);
  const lifecycle = disposableScript.indexOf("Invoke-ContainerPsql '/tmp/payroll-ft-ui-test.sql'");
  assert(firstApply >= 0 && secondApply > firstApply && lifecycle > secondApply);
  assertStringIncludes(
    disposableScript,
    "Assert-ContainerPsqlFailsWith '/tmp/payroll-telegram-delivery.sql' 'PAYROLL_DELIVERY_PARTIAL_DRIFT'",
  );
});

Deno.test("stale worker claims become a recorded unknown result rather than a resend", () => {
  assertStringIncludes(lifecycleSql, "stale send never finalizes completed");
  assertStringIncludes(lifecycleSql, "TELEGRAM_DISPATCH_UNCONFIRMED");
  assertStringIncludes(lifecycleSql, "stale send receipt is recorded once without an automatic resend");
});
