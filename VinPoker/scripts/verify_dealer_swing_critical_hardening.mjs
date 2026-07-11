import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];

function requireText(file, text, label) {
  const source = read(file);
  const ok = source.includes(text);
  checks.push({ ok, label, file });
}

function forbidText(file, text, label) {
  const source = read(file);
  const ok = !source.includes(text);
  checks.push({ ok, label, file });
}

for (const file of [
  "supabase/functions/assign-dealer/index.ts",
  "supabase/functions/close-table/index.ts",
  "supabase/functions/checkout-dealer/index.ts",
  "supabase/functions/mass-assign/index.ts",
]) {
  requireText(file, "authenticateUser(req)", `${file} verifies the signed Supabase user`);
  forbidText(file, "function decodeJWT", `${file} has no decode-only JWT identity`);
}

requireText(
  "supabase/functions/manage-break/index.ts",
  'is_club_dealer_control',
  "manage-break checks the authenticated actor's club scope",
);
requireText(
  "supabase/functions/telegram-swing-notifier/index.ts",
  'chat_id !== "__club__"',
  "Telegram notifier cannot target an arbitrary chat",
);
requireText(
  "supabase/functions/checkout-dealer/index.ts",
  "Mixed-club checkout batches are not allowed",
  "checkout rejects mixed-club batches before mutation",
);
requireText(
  "supabase/functions/assign-dealer/index.ts",
  "p_force_replace: false",
  "manual assignment cannot replace a dealer during a race",
);
requireText(
  "supabase/functions/process-swing/index.ts",
  "PROCESS_SWING_INTERNAL_SECRET",
  "process-swing has an internal scheduler credential path",
);
requireText(
  "supabase/functions/process-swing/index.ts",
  "aborting before mutation",
  "process-swing fails closed when the lease heartbeat errors",
);

const migration = "supabase/migrations/20261235000000_dealer_payroll_actor_binding.sql";
requireText(migration, "auth.uid()", "payroll wrappers bind actor to auth.uid()");
requireText(migration, "Invalid payroll transition", "payroll lifecycle rejects invalid state edges");
requireText(migration, "status IN ('draft', 'rejected')", "adjustments are closed after draft/rejected");
requireText(migration, "REVOKE ALL ON FUNCTION public.save_payroll_period", "legacy save RPC is not browser-callable");

const payrollHook = "src/hooks/useDealerPayroll.ts";
requireText(payrollHook, 'save_payroll_period_secure', "frontend calls secure payroll save wrapper");
requireText(payrollHook, 'transition_payroll_status_secure', "frontend calls secure lifecycle wrapper");
requireText(payrollHook, 'reconcile_payroll_payment_secure', "frontend calls secure reconciliation wrapper");

const payrollUi = "src/components/cashier/DealerPayrollTab.tsx";
requireText(payrollUi, "mergeSavedPayrollRows", "payroll UI renders stored snapshot rows");
requireText(payrollUi, '"payment_prepared", "paid", "reconciled"', "payroll UI disables edits after payment lifecycle starts");

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}`);
}
if (failures.length > 0) {
  process.exitCode = 1;
}
