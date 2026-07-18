import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationRelativePath = "supabase/migrations/20260717000001_process_swing_cron_vault_caller.sql";
const projectRoot = existsSync(resolve(process.cwd(), migrationRelativePath))
  ? process.cwd()
  : resolve(process.cwd(), "VinPoker");
const migrationPath = resolve(projectRoot, migrationRelativePath);
const sql = readFileSync(migrationPath, "utf8");

const mustContain = [
  "CREATE TABLE IF NOT EXISTS public.process_swing_cron_runs",
  "CREATE OR REPLACE FUNCTION public.run_process_swing_cron()",
  "SECURITY DEFINER",
  "SET search_path = public",
  "vault.decrypted_secrets",
  "name = 'PROCESS_SWING_INTERNAL_SECRET'",
  "net.http_post",
  "net._http_response",
  "response_status",
  "http_401",
  "http_403",
  "timeout",
  "cron.unschedule('process-swing')",
  "cron.unschedule('process-swing-auto')",
  "cron.schedule(\n  'process-swing',\n  '* * * * *'",
  "REVOKE ALL ON FUNCTION public.run_process_swing_cron() FROM PUBLIC, anon, authenticated",
  "GRANT EXECUTE ON FUNCTION public.run_process_swing_cron() TO service_role",
];

for (const needle of mustContain) {
  if (!sql.includes(needle)) throw new Error(`missing contract: ${needle}`);
}

const forbidden = [
  /eyJ[A-Za-z0-9_-]{20,}/,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /SUPABASE_ANON_KEY/i,
  /app\.settings\.service_role_key/i,
  /telegram_chat_id/i,
  /auto_swing_enabled/i,
  /INSERT\s+INTO\s+public\.swing_log/i,
  /INSERT\s+INTO\s+public\.swing_audit_logs/i,
];

for (const pattern of forbidden) {
  if (pattern.test(sql)) throw new Error(`forbidden contract match: ${pattern}`);
}

const scheduleCount = (sql.match(/cron\.schedule\(/g) ?? []).length;
if (scheduleCount !== 1) throw new Error(`expected one cron schedule, found ${scheduleCount}`);

console.log("PASS process-swing cron Vault migration contract");
