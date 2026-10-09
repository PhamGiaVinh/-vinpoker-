import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { inspectProcessSwingLeaseSafetyContract } from "./deploy/process-swing-lease-safety-contract.mjs";

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
  '"worker_assign_dealer_to_session_v1"',
  "manual assignment uses the exact-session server writer",
);
requireText(
  "supabase/functions/assign-dealer/index.ts",
  "p_table_session_id: table_session_id",
  "manual assignment binds its exact table session",
);
forbidText(
  "supabase/functions/assign-dealer/index.ts",
  '"assign_dealer_to_table"',
  "manual assignment cannot bypass the exact-session writer",
);
const assignmentFence = "supabase/migrations/20270128000022_dealer_assignment_off_commit_fence_v1.sql";
requireText(assignmentFence, "AND s.club_id=p_club_id AND s.closed_at IS NULL FOR UPDATE;",
  "assignment server locks the exact open club session");
requireText(assignmentFence, "a.status IN ('assigned','on_break','pre_assigned','reserved')",
  "assignment server treats every unreleased acquisition state as occupied");
requireText(assignmentFence, "RETURN jsonb_build_object('outcome','table_occupied'); END IF;",
  "manual assignment cannot replace a dealer during a race");
requireText(
  "supabase/functions/process-swing/index.ts",
  "PROCESS_SWING_INTERNAL_SECRET",
  "process-swing has an internal scheduler credential path",
);
checks.push(...inspectProcessSwingLeaseSafetyContract(root));

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
