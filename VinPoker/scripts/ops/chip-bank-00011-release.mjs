import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSqlText, scanMigrationSource } from "./ops-1359-release-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT_REF = "orlesggcjamwuknxwcpk";
const VERSION = "20270128000011";
const NAME = "chip_ops_bank_adjust_integrity_v1";
const MANIFEST_SHA256 = "82cba744239c8046d3f8b796efeb840ed2f234d74db2094105b8bb2667789bb1";
const RECEIPT_TAG = "$chip_bank_00011_receipt$";
const FUNCTION = "public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)";

export const sha256 = (source) => createHash("sha256").update(source, "utf8").digest("hex");

export function loadRelease(root = ROOT) {
  const manifestText = readFileSync(resolve(root, "scripts/ops/chip-bank-00011-manifest.json"), "utf8");
  if (sha256(canonicalSqlText(manifestText)) !== MANIFEST_SHA256) throw new Error("Exact manifest hash drift");
  const manifest = JSON.parse(manifestText);
  if (manifest.projectRef !== PROJECT_REF || manifest.version !== VERSION || manifest.name !== NAME ||
      manifest.filename !== `${VERSION}_${NAME}.sql` ||
      manifest.requiredReceipt?.version !== "20270128000010" ||
      manifest.requiredReceipt?.name !== "multi_day_after_end_play_guard_child_binding_v1" ||
      !/^[a-f0-9]{64}$/.test(manifest.normalizedSqlSha256) ||
      !/^[a-f0-9]{64}$/.test(manifest.previousBodySha256)) {
    throw new Error("Manifest identity differs from the reviewed one-migration scope");
  }
  const sql = canonicalSqlText(readFileSync(resolve(root, "supabase/migrations", manifest.filename), "utf8"));
  if (sha256(sql) !== manifest.normalizedSqlSha256) throw new Error("Migration SQL hash drift");
  if (scanMigrationSource(sql).mode !== "wrapped" || sql.includes(RECEIPT_TAG)) throw new Error("Unexpected migration transaction shape");
  const body = sql.match(/AS \$function\$([\s\S]*?)\$function\$/);
  if (!body) throw new Error("Expected function body is absent");
  return { manifest, sql, expectedBodySha256: sha256(body[1]) };
}

export function validateConnection(env) {
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF || env.PGHOST !== `db.${PROJECT_REF}.supabase.co` ||
      String(env.PGPORT) !== "5432" || env.PGUSER !== "postgres" || env.PGDATABASE !== "postgres" ||
      env.PGSSLMODE !== "require" || !env.PGPASSWORD) {
    throw new Error("Exact production connection context is unavailable");
  }
}

export function classifyPreflight(row, release) {
  const { manifest } = release;
  if (row.database !== "postgres" || row.actor !== "postgres" ||
      Number(row.required_count) !== 1 || row.required_name !== manifest.requiredReceipt.name ||
      Number(row.target_name_count) > 1 || Number(row.target_version_count) > 1) {
    throw new Error("Live database or migration receipt precondition failed");
  }
  if (Number(row.target_version_count) === 1 || Number(row.target_name_count) === 1) {
    if (Number(row.target_version_count) !== 1 || Number(row.target_name_count) !== 1 ||
        row.target_name !== NAME || row.target_sql_sha256 !== manifest.normalizedSqlSha256) {
      throw new Error("Target receipt collides with reviewed migration");
    }
    return "already-applied-exact";
  }
  if (row.previous_body_sha256 !== manifest.previousBodySha256) throw new Error("Live function body differs from reviewed precondition");
  return "pending";
}

export function preflightSql() {
  return `SELECT json_build_object(
    'database', current_database(), 'actor', current_user,
    'required_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20270128000010'),
    'required_name', (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '20270128000010' LIMIT 1),
    'target_version_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}'),
    'target_name_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '${NAME}'),
    'target_name', (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}' LIMIT 1),
    'target_sql_sha256', (SELECT encode(extensions.digest(convert_to(statements[1], 'UTF8'), 'sha256'), 'hex') FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}' LIMIT 1),
    'previous_body_sha256', (SELECT encode(extensions.digest(convert_to(prosrc, 'UTF8'), 'sha256'), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${FUNCTION}'))
  )::text;`;
}

export function buildAtomicQuery(release) {
  const { manifest, sql } = release;
  const guard = `DO $chip_bank_00011_guard$ BEGIN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}' OR name = '${NAME}') THEN
      RAISE EXCEPTION 'target migration receipt already exists';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${manifest.requiredReceipt.version}' AND name = '${manifest.requiredReceipt.name}') THEN
      RAISE EXCEPTION 'required predecessor receipt differs';
    END IF;
  END $chip_bank_00011_guard$;`;
  return `BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';\nSELECT pg_advisory_xact_lock(280000, 11);\n${guard}\n${sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${VERSION}','${NAME}',ARRAY[${RECEIPT_TAG}${sql}${RECEIPT_TAG}]::text[]);\nCOMMIT;`;
}

export function postcheckSql() {
  return `SELECT json_build_object(
    'receipt_count', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}' AND name = '${NAME}'),
    'receipt_sql_sha256', (SELECT encode(extensions.digest(convert_to(statements[1], 'UTF8'), 'sha256'), 'hex') FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}' LIMIT 1),
    'body_sha256', (SELECT encode(extensions.digest(convert_to(prosrc, 'UTF8'), 'sha256'), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${FUNCTION}')),
    'anon_execute', has_function_privilege('anon','${FUNCTION}','EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated','${FUNCTION}','EXECUTE')
  )::text;`;
}

export function classifyPostcheck(row, release) {
  if (Number(row.receipt_count) !== 1 || row.receipt_sql_sha256 !== release.manifest.normalizedSqlSha256 ||
      row.body_sha256 !== release.expectedBodySha256 || row.anon_execute !== false ||
      row.authenticated_execute !== true) throw new Error("Live receipt/function/ACL postcheck failed");
  return "postcheck-passed";
}

function query(sql) {
  const result = spawnSync(process.env.PSQL_BIN || "psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: sql, encoding: "utf8", env: process.env, maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw new Error(`psql could not start: ${result.error.code ?? result.error.message}`);
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status}); review local stderr privately before retrying`);
  return result.stdout.trim();
}

function run() {
  const mode = process.argv[2];
  if (!["plan", "apply", "postcheck"].includes(mode)) throw new Error("Usage: chip-bank-00011-release.mjs plan|apply|postcheck");
  const release = loadRelease();
  validateConnection(process.env);
  if (mode === "postcheck") {
    classifyPostcheck(JSON.parse(query(postcheckSql())), release);
    process.stdout.write("POSTCHECK_PASS 20270128000011\n");
    return;
  }
  const state = classifyPreflight(JSON.parse(query(preflightSql())), release);
  if (mode === "plan") {
    process.stdout.write(`PLAN ${VERSION} ${state} ${release.manifest.normalizedSqlSha256}\n`);
    return;
  }
  if (process.env.CONFIRM_CHIP_BANK_00011 !== `APPLY_${VERSION}_${release.manifest.normalizedSqlSha256}`) {
    throw new Error("Exact apply confirmation is absent");
  }
  if (state === "pending") query(buildAtomicQuery(release));
  classifyPostcheck(JSON.parse(query(postcheckSql())), release);
  process.stdout.write(`APPLY_AND_POSTCHECK_PASS ${VERSION} ${state}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
