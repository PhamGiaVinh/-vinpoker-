#!/usr/bin/env node
// Disposable D2A + D2B PostgreSQL 17 probe. Refuses non-local hosts and never contacts Supabase.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../..");
const d2a = join(app, "supabase/migrations/20270107000001_series_decision_packet_v1.sql");
const d2b = join(app, "supabase/migrations/20270108000002_series_private_actual_truth_runtime_v1.sql");
const bootstrap = join(here, "disposable-decision-packet-runtime-pg17-bootstrap.sql");
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function parseArgs(argv) { if (argv.length !== 4 || argv[2] !== "--report") throw new Error("usage: probe-decision-packet-runtime-pg17.mjs --report <path>"); return resolve(argv[3]); }
function config() {
  if (process.env.D2B_PG17_ALLOW_DISPOSABLE !== "1") throw new Error("D2B_PG17_ALLOW_DISPOSABLE=1 is required");
  const host = process.env.PGHOST ?? "127.0.0.1";
  if (!localHosts.has(host)) throw new Error("D2B probe refuses a non-local PostgreSQL host");
  return { host, port: process.env.PGPORT ?? "5432", user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", admin: process.env.D2B_PG17_ADMIN_DATABASE ?? "postgres" };
}
function psql(c, db, statement, actor) {
  const prelude = actor ? `SET request.jwt.claim.sub TO ${sql(actor)}; SET ROLE authenticated;` : "RESET request.jwt.claim.sub;";
  const run = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--host", c.host, "--port", c.port, "--username", c.user, "--dbname", db], { input: `${prelude}\n${statement}\nRESET ROLE;`, encoding: "utf8", env: { ...process.env, PGHOST: c.host, PGPORT: c.port, PGUSER: c.user, PGPASSWORD: c.password } });
  if (run.error) throw new Error(`psql execution failed: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${run.stdout}\n${run.stderr}`.trim());
  return run.stdout.trim();
}
function expect(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const reportPath = parseArgs(process.argv); const c = config();
  const [d2aSql, d2bSql, bootstrapSql] = await Promise.all([readFile(d2a), readFile(d2b), readFile(bootstrap)]);
  const database = `d2b_probe_${process.pid}_${Date.now()}`; const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, status: "pass" }); } catch (error) { checks.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) }); } };
  try {
    psql(c, c.admin, `CREATE DATABASE ${database}`); psql(c, database, bootstrapSql.toString()); psql(c, database, d2aSql.toString()); psql(c, database, d2bSql.toString());
    const owner = "11111111-1111-4111-8111-111111111111"; const club = "abcdefab-cdef-4abc-8abc-abcdefabcdef"; const event = "bcdefabc-defa-4bcd-8bcd-bcdefabcdef1";
    psql(c, database, `INSERT INTO public.clubs(id,owner_id) VALUES (${sql(club)}::uuid,${sql(owner)}::uuid); INSERT INTO public.tournaments(id,club_id,start_time,status,updated_at,guarantee_amount) VALUES (${sql(event)}::uuid,${sql(club)}::uuid,'2026-08-01T00:00:00Z','completed','2026-08-02T00:00:00Z',600000000); INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,status,buy_in,platform_fixed_fee,total_pay,updated_at) VALUES ('50000000-0000-4000-8000-000000000001',${sql(event)}::uuid,${sql(club)}::uuid,'60000000-0000-4000-8000-000000000001','confirmed',300000000,30000000,330000000,'2026-08-02T00:00:00Z'),('50000000-0000-4000-8000-000000000002',${sql(event)}::uuid,${sql(club)}::uuid,'60000000-0000-4000-8000-000000000001','confirmed',300000000,30000000,330000000,'2026-08-02T00:00:00Z')`);
    check("owner_native_promotion_creates_final_event_total_truth", () => { const result = psql(c, database, `SELECT public.series_promote_native_event_actual_v1(${sql(event)}::uuid,'native:0001')`, owner); expect(result.includes('"state": "created"'), result); });
    check("same_native_source_replays_idempotently", () => { const result = psql(c, database, `SELECT public.series_promote_native_event_actual_v1(${sql(event)}::uuid,'native:0002')`, owner); expect(result.includes('"state": "idempotent"'), result); });
    check("native_counts_and_prize_pool_exclude_fee", () => { const result = psql(c, database, `SELECT entries_value::text || ':' || unique_players_value::text || ':' || prize_pool_amount_minor::text FROM public.series_event_actual_revisions_v1`, owner); expect(result === "2:1:600000000", result); });
    check("anonymous_promotion_fails", () => { let failed = false; try { psql(c, database, `SELECT public.series_promote_native_event_actual_v1(${sql(event)}::uuid,'native:0003')`); } catch { failed = true; } expect(failed, "anonymous promotion unexpectedly succeeded"); });
    check("event_state_omits_player_identity", () => { const result = psql(c, database, `SELECT public.series_get_decision_event_state_v1(${sql(event)}::uuid)::text`, owner); expect(!/playerId|60000000/i.test(result), result); });
  } finally {
    try { psql(c, c.admin, `DROP DATABASE IF EXISTS ${database}`); } catch { /* report still captures cleanup inability */ }
    const report = { contract: "d2b-private-actual-truth-runtime-pg17-v1", postgresTarget: "17", d2aMigrationSha256: sha(d2aSql), d2bMigrationSha256: sha(d2bSql), bootstrapSha256: sha(bootstrapSql), checks, passed: checks.every((item) => item.status === "pass") };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  }
}
main().catch(async (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
