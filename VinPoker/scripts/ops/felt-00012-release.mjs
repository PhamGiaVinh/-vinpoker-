import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const version = "20270128000012";
const name = "felt_lifecycle_close_guards_v1";
const project = "orlesggcjamwuknxwcpk";
const expectedSha256 = "3185b1c3c367d8ccf814023b31d3bfaeb52059fe5149db145e63385fc7e9b612";
const filename = `${version}_${name}.sql`;
const receiptTag = "$felt_00012_receipt$";

export function loadRelease() {
  const sql = readFileSync(resolve(root, "supabase/migrations", filename), "utf8").replace(/\r\n?/g, "\n");
  const hash = createHash("sha256").update(sql, "utf8").digest("hex");
  if (hash !== expectedSha256 || sql.includes(receiptTag)) throw new Error("Exact 00012 SQL digest or receipt delimiter differs");
  const wrapped = sql.match(/^([\s\S]*?)\nBEGIN;\n([\s\S]*?)\nCOMMIT;\s*$/);
  if (!wrapped || /(?:^|\n)(?:BEGIN|COMMIT);\s*(?:\n|$)/.test(wrapped[2])) {
    throw new Error("Expected one BEGIN/COMMIT wrapper");
  }
  return { sql, body: `${wrapped[1]}\n${wrapped[2]}`, hash };
}

export function validateConnection(env) {
  if (env.SUPABASE_PROJECT_REF !== project || env.PGHOST !== "aws-1-ap-southeast-2.pooler.supabase.com" ||
      String(env.PGPORT) !== "5432" || env.PGUSER !== `postgres.${project}` ||
      env.PGDATABASE !== "postgres" || env.PGSSLMODE !== "require" || !env.PGPASSWORD) {
    throw new Error("Exact production connection context is unavailable");
  }
}

export function preflightSql() {
  return `SELECT json_build_object(
    'database', current_database(), 'actor', current_user,
    'predecessor_count', (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20270128000011' AND name = 'chip_ops_bank_adjust_integrity_v1'),
    'target_version_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${version}'),
    'target_name_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '${name}'),
    'voice_duplicate_equal', (SELECT replace(a.statements[1], E'\\r\\n', E'\\n') =
      replace(b.statements[1], E'\\r\\n', E'\\n') FROM supabase_migrations.schema_migrations a
      JOIN supabase_migrations.schema_migrations b ON a.version = '20270115000019' AND b.version = '20270115000020')
  )::text;`;
}

export function classifyPreflight(row) {
  if (row.database !== "postgres" || row.actor !== "postgres" || Number(row.predecessor_count) !== 1 ||
      Number(row.target_version_count) !== 0 || Number(row.target_name_count) !== 0 || row.voice_duplicate_equal !== true) {
    throw new Error("Live release precondition failed; no migration applied");
  }
  return "pending";
}

export function atomicSql(release) {
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(280000, 12);
DO $felt_00012_guard$ BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${version}' OR name = '${name}') THEN
    RAISE EXCEPTION 'felt_00012_receipt_exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20270128000011' AND name = 'chip_ops_bank_adjust_integrity_v1') THEN
    RAISE EXCEPTION 'felt_00012_predecessor_missing';
  END IF;
END $felt_00012_guard$;
${release.body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('${version}','${name}',ARRAY[${receiptTag}${release.sql}${receiptTag}]::text[]);
COMMIT;`;
}

export function postcheckSql() {
  return `SELECT json_build_object(
    'receipt_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${version}' AND name = '${name}'),
    'receipt_sha256', (SELECT encode(extensions.digest(convert_to(replace(statements[1], E'\\r\\n', E'\\n'), 'UTF8'), 'sha256'), 'hex')
      FROM supabase_migrations.schema_migrations WHERE version = '${version}' LIMIT 1),
    'tour_guard', to_regprocedure('floor_private.felt_guard_tour_archive_v1()') IS NOT NULL,
    'trigger_count', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
      AND ((tgrelid = 'public.dealer_swing_archives'::regclass AND tgname = 'trg_felt_guard_tour_archive_v1')
        OR (tgrelid = 'public.game_tables'::regclass AND tgname = 'trg_felt_guard_table_deactivation_v1')
        OR (tgrelid = 'public.tournament_close_report'::regclass AND tgname = 'trg_felt_guard_close_report_v1'))),
    'dealer_readiness', to_regprocedure('public.get_dealer_tour_close_readiness_v1(uuid,uuid)') IS NOT NULL,
    'tournament_readiness', to_regprocedure('public.get_tournament_close_readiness_v1(uuid)') IS NOT NULL,
    'dealer_anon_execute', has_function_privilege('anon','public.get_dealer_tour_close_readiness_v1(uuid,uuid)','EXECUTE'),
    'dealer_authenticated_execute', has_function_privilege('authenticated','public.get_dealer_tour_close_readiness_v1(uuid,uuid)','EXECUTE'),
    'anon_execute', has_function_privilege('anon','public.get_tournament_close_readiness_v1(uuid)','EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated','public.get_tournament_close_readiness_v1(uuid)','EXECUTE')
  )::text;`;
}

export function classifyPostcheck(row) {
  if (Number(row.receipt_count) !== 1 || row.receipt_sha256 !== expectedSha256 ||
      row.tour_guard !== true || Number(row.trigger_count) !== 3 ||
      row.dealer_readiness !== true || row.tournament_readiness !== true ||
      row.dealer_anon_execute !== false || row.dealer_authenticated_execute !== true ||
      row.anon_execute !== false || row.authenticated_execute !== true) {
    throw new Error("Postcheck failed; inspect live state without retrying");
  }
  return "pass";
}

function query(sql) {
  const env = { ...process.env, WSLENV: [...(process.env.WSLENV || "").split(":").filter(Boolean),
    "PGHOST/u", "PGPORT/u", "PGUSER/u", "PGDATABASE/u", "PGSSLMODE/u", "PGPASSWORD/u"].join(":") };
  const result = spawnSync("wsl", ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", env, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("psql failed; inspect local stderr privately, do not retry blindly");
  return result.stdout.trim();
}

function queryJson(sql) {
  return JSON.parse(query(sql).split(/\r?\n/).at(-1));
}

function run() {
  const mode = process.argv[2];
  if (!["plan", "apply", "postcheck"].includes(mode)) throw new Error("Usage: felt-00012-release.mjs plan|apply|postcheck");
  const release = loadRelease();
  validateConnection(process.env);
  if (mode === "postcheck") {
    classifyPostcheck(queryJson(postcheckSql()));
    process.stdout.write("POSTCHECK_PASS 20270128000012\n");
    return;
  }
  classifyPreflight(queryJson(preflightSql()));
  if (mode === "plan") {
    process.stdout.write(`PLAN ${version} ONLY ${release.hash}\n`);
    return;
  }
  if (process.env.CONFIRM_FELT_00012 !== `APPLY_${version}_${release.hash}`) {
    throw new Error("Exact apply confirmation is absent");
  }
  query(atomicSql(release));
  classifyPostcheck(queryJson(postcheckSql()));
  process.stdout.write(`APPLY_AND_POSTCHECK_PASS ${version}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
