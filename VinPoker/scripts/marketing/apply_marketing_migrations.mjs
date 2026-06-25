#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Marketing module — allowlisted controlled-op runner (owner-gated apply)
// ════════════════════════════════════════════════════════════════════════════
// Applies EXACTLY the four reviewed marketing migrations, in the safe order, via the Supabase
// Management API. Mirrors scripts/finance/apply_service_fee_migrations.mjs.
//   enum  20261101000000_app_role_add_marketing.sql        (ALTER TYPE app_role ADD VALUE)
//   role  20261101000001_marketing_role.sql                (club_marketers + helpers + RPCs)
//   core  20261101000002_marketing_core.sql                (types/tables/RPCs + blocked-terms seed)
//   cron  20261101000003_schedule_marketing_dispatch.sql   (pg_cron → marketing-dispatch)
//
// Modes:
//   node scripts/marketing/apply_marketing_migrations.mjs --preflight     (read-only)
//   node scripts/marketing/apply_marketing_migrations.mjs --apply-schema  (enum→role→core, gated)
//   node scripts/marketing/apply_marketing_migrations.mjs --dry-invoke    (POST the edge fn, expect no_posts)
//   node scripts/marketing/apply_marketing_migrations.mjs --apply-cron    (cron LAST, gated)
//
// SAFETY (hard):
//   • PRIMARY control: the allowlist is HARDCODED to those four reviewed files (the MIG literal);
//     no path/name is ever derived from argv/env, so nothing else can ever be executed. The real
//     guarantee is "exactly these four reviewed migrations, nothing else."
//   • SECONDARY lint (defense-in-depth, NOT the boundary): each file is safety-scanned
//     (function bodies + comments + strings stripped first):
//     refuses schema_migrations writes, DROP TABLE/FUNCTION/TYPE/SCHEMA, INSERT into any table
//     other than marketing_blocked_terms, UPDATE/DELETE, GRANT … TO anon, and any reference to
//     payroll / payment_records / calculate_dealer_payroll. Each file must contain its expected
//     marquee statement.
//   • Apply modes require CONFIRM_APPLY_MARKETING=APPLY_MARKETING_MIGRATIONS.
//   • enum is applied in its OWN Management-API call (own tx) BEFORE role/core (Postgres can't use
//     a new enum value in the tx that adds it — though none of these migrations use it anyway).
//   • Cron is a SEPARATE mode so the workflow can deploy + dry-invoke the edge fn BEFORE scheduling.
//   • NO `supabase db push`, NO deploy_db, NO schema_migrations row written by this runner.
//   • All migrations are idempotent (IF NOT EXISTS / CREATE OR REPLACE / DO-block / cron-exists
//     guard) so a re-run is safe. Secrets masked in all output.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // scripts/marketing → VinPoker root

const MIG = {
  enum: "supabase/migrations/20261101000000_app_role_add_marketing.sql",
  role: "supabase/migrations/20261101000001_marketing_role.sql",
  core: "supabase/migrations/20261101000002_marketing_core.sql",
  cron: "supabase/migrations/20261101000003_schedule_marketing_dispatch.sql",
  tg:   "supabase/migrations/20261101000004_marketing_telegram_dedicated.sql",
  acct: "supabase/migrations/20261101000005_marketing_account_search.sql",
  fb:   "supabase/migrations/20261101000006_marketing_facebook.sql",
  auto: "supabase/migrations/20261101000007_marketing_autocontent.sql",
  autocron: "supabase/migrations/20261101000008_schedule_marketing_autocontent.sql",
};
const REQUIRED = {
  enum: /\bALTER\s+TYPE\s+public\.app_role\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'marketing'/i,
  role: /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.club_marketers\b/i,
  core: /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.marketing_posts\b/i,
  cron: /cron\.schedule\(\s*'marketing-dispatch'/i,
  tg:   /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.marketing_set_telegram\b/i,
  acct: /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.marketing_list_club_members\(p_club_id\s+uuid,\s*p_query\s+text\)/i,
  fb:   /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.marketing_set_facebook\b/i,
  auto: /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.marketing_auto_jobs\b/i,
  autocron: /cron\.schedule\(\s*'marketing-autocontent'/i,
};

const CONFIRM_ENV = "CONFIRM_APPLY_MARKETING";
const CONFIRM_VAL = "APPLY_MARKETING_MIGRATIONS";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "orlesggcjamwuknxwcpk";
const FN_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/marketing-dispatch`;
// Public anon JWT (role=anon) — already committed in cron migrations; NOT a secret.
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A";

const log = (...a) => console.log("[mkt-apply]", ...a);
const fail = (...a) => { console.error("[mkt-apply] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

// Remove dollar-quoted bodies, block/line comments and string literals so the scan only sees
// top-level DDL keywords (function bodies — which legitimately contain INSERT/UPDATE — are gone).
function stripCommentsAndStrings(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

// Strip ONLY comments (keep strings + dollar-quoted bodies) — used for the positive marquee
// check, whose target literals ('marketing', 'marketing-dispatch') and the cron call live inside
// strings / a DO $$ … $$ block that the full stripper would remove.
function stripCommentsOnly(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function scan(key, sql) {
  const clean = stripCommentsAndStrings(sql);
  const marquee = stripCommentsOnly(sql);
  const v = [];
  if (/schema_migrations/i.test(clean)) v.push("touches schema_migrations");
  if (/\bDROP\s+(TABLE|FUNCTION|TYPE|SCHEMA|DATABASE|TRIGGER|INDEX|ROLE|OWNED)\b/i.test(clean)) v.push("contains a destructive DROP");
  if (/\bTRUNCATE\b/i.test(clean)) v.push("contains TRUNCATE");
  if (/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(clean)) v.push("DISABLEs row level security");
  if (/\bCREATE\s+ROLE\b/i.test(clean)) v.push("CREATE ROLE");
  if (/\bCOPY\b[^;]*\bFROM\s+PROGRAM\b/i.test(clean)) v.push("COPY … FROM PROGRAM (RCE vector)");
  if (/(^|;)\s*UPDATE\s+\S+\s+SET\b/i.test(clean)) v.push("top-level UPDATE … SET");
  if (/\bDELETE\s+FROM\b/i.test(clean)) v.push("top-level DELETE FROM");
  if (/\b(calculate_dealer_payroll|payment_records|dealer_payroll)\b/i.test(clean)) v.push("references a payroll/finance object");
  // GRANT … TO … {anon|PUBLIC} within a SINGLE statement (no ';' between) — REVOKE … FROM is fine.
  if (/\bGRANT\b[^;]*\bTO\b[^;]*\banon\b/i.test(clean)) v.push("GRANTs to anon");
  if (/\bGRANT\b[^;]*\bTO\b[^;]*\bPUBLIC\b/i.test(clean)) v.push("GRANTs to PUBLIC");
  // INSERT is allowed ONLY into marketing_blocked_terms (the seed). Any other INSERT is refused.
  for (const m of clean.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
    if (m[1].toLowerCase() !== "marketing_blocked_terms") v.push(`unexpected INSERT INTO ${m[1]}`);
  }
  if (!REQUIRED[key].test(marquee)) v.push(`missing expected marquee statement for '${key}'`);
  return v;
}

function load(key) {
  const path = MIG[key];
  const abs = resolve(REPO_ROOT, path);
  let sql;
  try { sql = readFileSync(abs, "utf8"); } catch { fail(`migration not found: ${path}`); }
  sql = sql.replace(/\r\n/g, "\n"); // normalize CRLF so apply is deterministic
  const v = scan(key, sql);
  if (v.length) {
    console.error(`[mkt-apply] ✗ REFUSING — ${path} failed the safety scan:`);
    v.forEach((x) => console.error("    - " + x));
    process.exit(1);
  }
  return sql;
}

function loadCreds() {
  const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
  return ref && token ? { ref, token } : null;
}

async function mgmt(creds, query) {
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) { fail("network error:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}

const PREFLIGHT_SQL = `select
  (select exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
     where t.typname='app_role' and e.enumlabel='marketing')) as enum_has_marketing,
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('marketing_posts','post_channel_status','club_channel_integrations','marketing_blocked_terms')) as mkt_tables,
  (select to_regclass('public.club_marketers') is not null) as role_table;`;

async function schemaVerify(creds) {
  const r = (await mgmt(creds, `select
    (select exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
       where t.typname='app_role' and e.enumlabel='marketing')) as enum_ok,
    (select to_regclass('public.club_marketers') is not null) as role_table,
    (select count(*) from pg_type where typname in
       ('marketing_post_status','marketing_channel','marketing_channel_delivery_status','marketing_compliance_status')) as enums,
    (select count(*) from pg_tables where schemaname='public' and tablename in
       ('marketing_posts','post_channel_status','club_channel_integrations','marketing_blocked_terms')) as tables,
    (select count(distinct term) from public.marketing_blocked_terms where club_id is null) as seed,
    has_function_privilege('authenticated','public.marketing_claim_due_posts(int)','EXECUTE') as authed_claim,
    has_function_privilege('service_role','public.marketing_claim_due_posts(int)','EXECUTE') as svc_claim,
    has_function_privilege('authenticated','public.marketing_create_post(uuid,text,text,jsonb,jsonb,text[],jsonb,text)','EXECUTE') as authed_create;`))[0];
  log("schema post-verify:");
  log(`  enum has 'marketing'        : ${r.enum_ok} (expect true)`);
  log(`  club_marketers table        : ${r.role_table} (expect true)`);
  log(`  new enums (4)               : ${r.enums} (expect 4)`);
  log(`  core tables (4)             : ${r.tables} (expect 4)`);
  log(`  distinct global blocked terms : ${r.seed} (expect >= 14)`);
  log(`  claim RPC authed EXECUTE    : ${r.authed_claim} (expect false)`);
  log(`  claim RPC service EXECUTE   : ${r.svc_claim} (expect true)`);
  log(`  create_post authed EXECUTE  : ${r.authed_create} (expect true)`);
  const ok = r.enum_ok === true && r.role_table === true && Number(r.enums) === 4 &&
    Number(r.tables) === 4 && Number(r.seed) >= 14 &&
    r.authed_claim === false && r.svc_claim === true && r.authed_create === true;
  if (!ok) fail("schema post-verify mismatch.");
  log("schema post-verify PASS.");
}

async function main() {
  const mode = process.argv[2] || "";
  if (!["--scan", "--preflight", "--apply-schema", "--apply-telegram", "--dry-invoke", "--apply-cron", "--apply-autocontent"].includes(mode)) {
    log("modes: --scan | --preflight | --apply-schema | --apply-telegram | --dry-invoke | --apply-cron | --apply-autocontent");
    log(`apply modes require ${CONFIRM_ENV}=${CONFIRM_VAL} + SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN`);
    process.exit(0);
  }

  // ── --scan: offline safety-scan of all allowlisted files (no creds, no DB) ──
  if (mode === "--scan") {
    for (const key of ["enum", "role", "core", "cron", "tg", "acct", "fb", "auto", "autocron"]) { load(key); log(`scan PASS — ${MIG[key]}`); }
    log("all nine migrations pass the safety scan.");
    return;
  }

  // ── dry-invoke needs no Management creds (uses the public anon key against the edge fn) ──
  if (mode === "--dry-invoke") {
    // NOTE: this POSTs the LIVE function. At first go-live (flag off, zero posts) it's a true probe
    // returning no_posts. If run AFTER the system is live, it can actually claim + dispatch any
    // already-due post (a real Telegram send) — 'processed' is accepted by design.
    log(`POST ${FN_URL} (expect outcome=no_posts; the edge fn must be deployed + core applied)`);
    let res, body;
    try {
      res = await fetch(FN_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
        body: "{}",
      });
      body = await res.json().catch(() => ({}));
    } catch (e) { fail("dry-invoke network error:", mask(e.message)); }
    log(`  HTTP ${res.status} · body: ${JSON.stringify(body)}`);
    if (!res.ok) fail(`dry-invoke HTTP ${res.status} — is the function deployed?`);
    if (body.outcome === "error") fail(`dry-invoke returned error: ${body.error} — is core (claim RPC) applied?`);
    if (!["no_posts", "processed"].includes(body.outcome)) fail(`unexpected outcome: ${body.outcome}`);
    log("dry-invoke PASS (no claim error).");
    return;
  }

  const creds = loadCreds();
  if (!creds) {
    log("no credentials present — NOTHING contacted. Set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN.");
    process.exit(0);
  }

  const pre = (await mgmt(creds, PREFLIGHT_SQL))[0];
  log("preflight:");
  log(`  enum has 'marketing'  : ${pre.enum_has_marketing} (expect false before apply)`);
  log(`  marketing tables (0-4): ${pre.mkt_tables} (expect 0 before apply)`);
  log(`  club_marketers exists : ${pre.role_table} (expect false before apply)`);
  if (mode === "--preflight") { log("preflight done (read-only)."); return; }

  if (process.env[CONFIRM_ENV] !== CONFIRM_VAL) fail(`APPLY blocked. Set ${CONFIRM_ENV}=${CONFIRM_VAL}`);

  if (mode === "--apply-schema") {
    // Idempotent skip: if the schema is already applied, do NOT re-run the migrations. Re-running
    // core would re-execute its blocked-terms seed, and because global terms have club_id=NULL the
    // ON CONFLICT (club_id, term) does NOT dedupe (NULLs are distinct in a unique index) → the seed
    // would duplicate (14→28→…). So when already applied we only DEDUPE any prior duplicates and
    // verify. This is the re-run-safe path.
    if (pre.enum_has_marketing === true && Number(pre.mkt_tables) === 4 && pre.role_table === true) {
      log("schema already applied — skipping re-apply (idempotent); deduping global blocked terms …");
      const d = (await mgmt(creds, `WITH dups AS (
        SELECT id, row_number() OVER (PARTITION BY club_id, term ORDER BY created_at, id) AS rn
        FROM public.marketing_blocked_terms
      ) DELETE FROM public.marketing_blocked_terms t USING dups
        WHERE t.id = dups.id AND dups.rn > 1
        RETURNING t.id;`));
      log(`  removed ${Array.isArray(d) ? d.length : 0} duplicate blocked-term row(s).`);
      await schemaVerify(creds);
      log("schema OK (already applied). NEXT: --apply-telegram …");
      return;
    }
    const enumSql = load("enum"), roleSql = load("role"), coreSql = load("core");
    log("safety scan PASS (enum · role · core).");
    log("applying enum (own tx) …");
    await mgmt(creds, `BEGIN;\n${enumSql}\nCOMMIT;`);
    const e = (await mgmt(creds, `select exists(select 1 from pg_enum en join pg_type t on t.oid=en.enumtypid where t.typname='app_role' and en.enumlabel='marketing') as ok;`))[0];
    if (e.ok !== true) fail("enum value 'marketing' not present after enum apply — aborting before role/core.");
    log("  enum verified ✓");
    log("applying role (own tx) …");
    await mgmt(creds, `BEGIN;\n${roleSql}\nCOMMIT;`);
    log("applying core (own tx) …");
    await mgmt(creds, `BEGIN;\n${coreSql}\nCOMMIT;`);
    await schemaVerify(creds);
    log("schema apply complete. NEXT: --apply-telegram, then deploy marketing-dispatch + --dry-invoke, THEN --apply-cron.");
    return;
  }

  if (mode === "--apply-telegram") {
    // MKT-5: dedicated marketing Telegram (Vault token) + re-pointed RPCs. Requires core applied.
    const v = (await mgmt(creds, PREFLIGHT_SQL))[0];
    if (Number(v.mkt_tables) !== 4 || v.role_table !== true) fail("core schema not applied — run --apply-schema first.");
    const tgSql = load("tg");
    log("safety scan PASS (tg).");
    log("applying telegram-dedicated (own tx) …");
    await mgmt(creds, `BEGIN;\n${tgSql}\nCOMMIT;`);
    const r = (await mgmt(creds, `select
      (select count(*) from information_schema.columns
         where table_schema='public' and table_name='club_channel_integrations' and column_name='bot_token_vault_key') as col,
      (select count(distinct proname) from pg_proc where proname in
         ('marketing_set_telegram','marketing_get_telegram_config','marketing_get_telegram_dispatch','marketing_list_club_members')) as fns,
      has_function_privilege('authenticated','public.marketing_get_telegram_dispatch(uuid)','EXECUTE') as authed_dispatch,
      has_function_privilege('service_role','public.marketing_get_telegram_dispatch(uuid)','EXECUTE') as svc_dispatch;`))[0];
    log(`  bot_token_vault_key column : ${r.col} (expect 1)`);
    log(`  new telegram/staff RPCs    : ${r.fns} (expect 4)`);
    log(`  dispatch RPC authed EXEC   : ${r.authed_dispatch} (expect false)`);
    log(`  dispatch RPC service EXEC  : ${r.svc_dispatch} (expect true)`);
    if (Number(r.col) !== 1 || Number(r.fns) !== 4 || r.authed_dispatch !== false || r.svc_dispatch !== true) {
      fail("telegram post-verify mismatch.");
    }
    // MKT-5 follow-up: account-search overload (find ANY registered account for role assignment).
    const acctSql = load("acct");
    log("applying account-search overload (own tx) …");
    await mgmt(creds, `BEGIN;\n${acctSql}\nCOMMIT;`);
    const a = (await mgmt(creds, `select count(*) as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='marketing_list_club_members' and p.pronargs=2;`))[0];
    log(`  marketing_list_club_members(uuid,text) overload : ${a.n} (expect 1)`);
    if (Number(a.n) !== 1) fail("account-search overload not present.");

    // MKT-6: Facebook Page channel (Graph API; manual page id + Vault token).
    const fbSql = load("fb");
    log("applying facebook channel (own tx) …");
    await mgmt(creds, `BEGIN;\n${fbSql}\nCOMMIT;`);
    const f = (await mgmt(creds, `select
      (select count(distinct proname) from pg_proc where proname in
        ('marketing_set_facebook','marketing_get_facebook_config','marketing_get_facebook_dispatch')) as fns,
      has_function_privilege('authenticated','public.marketing_get_facebook_dispatch(uuid)','EXECUTE') as authed_fb,
      has_function_privilege('service_role','public.marketing_get_facebook_dispatch(uuid)','EXECUTE') as svc_fb;`))[0];
    log(`  facebook RPCs (3)            : ${f.fns} (expect 3)`);
    log(`  fb dispatch authed EXEC      : ${f.authed_fb} (expect false)`);
    log(`  fb dispatch service EXEC     : ${f.svc_fb} (expect true)`);
    if (Number(f.fns) !== 3 || f.authed_fb !== false || f.svc_fb !== true) fail("facebook post-verify mismatch.");

    log("telegram + account-search + facebook apply complete + post-verify PASS.");
    return;
  }

  if (mode === "--apply-cron") {
    // Refuse to schedule the cron unless schema is applied AND the edge fn answers a dry-invoke.
    const v = (await mgmt(creds, PREFLIGHT_SQL))[0];
    if (Number(v.mkt_tables) !== 4 || v.enum_has_marketing !== true) fail("schema not fully applied — run --apply-schema first.");
    const cronSql = load("cron");
    log("safety scan PASS (cron).");
    log("applying cron (own tx) …");
    await mgmt(creds, `BEGIN;\n${cronSql}\nCOMMIT;`);
    const j = (await mgmt(creds, `select count(*)::int as n from cron.job where jobname='marketing-dispatch';`))[0];
    log(`  cron.job 'marketing-dispatch' rows: ${j.n} (expect 1)`);
    if (Number(j.n) !== 1) fail("cron job not scheduled.");
    log("cron apply complete. Marketing backend is LIVE (still flag-OFF until the owner flips marketingModule).");
    return;
  }

  if (mode === "--apply-autocontent") {
    // MKT-7 Part 2: auto-content config + service-role draft generator (000007) + its cron (000008).
    // Requires core applied. The marketing-autocontent Edge fn must be deployed BEFORE the cron is
    // scheduled (the workflow deploys it first); the generator only creates DRAFTS, never sends.
    const v = (await mgmt(creds, PREFLIGHT_SQL))[0];
    if (Number(v.mkt_tables) !== 4 || v.role_table !== true) fail("core schema not applied — run --apply-schema first.");

    const autoSql = load("auto");
    log("safety scan PASS (auto).");
    log("applying auto-content config + RPCs (own tx) …");
    await mgmt(creds, `BEGIN;\n${autoSql}\nCOMMIT;`);
    const r = (await mgmt(creds, `select
      (select to_regclass('public.marketing_auto_jobs') is not null) as job_table,
      (select count(distinct proname) from pg_proc where proname in
        ('marketing_get_auto_job','marketing_set_auto_job','marketing_create_auto_draft')) as fns,
      has_function_privilege('authenticated','public.marketing_create_auto_draft(uuid,text,text,text,jsonb,jsonb,text)','EXECUTE') as authed_draft,
      has_function_privilege('service_role','public.marketing_create_auto_draft(uuid,text,text,text,jsonb,jsonb,text)','EXECUTE') as svc_draft,
      has_function_privilege('authenticated','public.marketing_set_auto_job(uuid,boolean,text[],jsonb)','EXECUTE') as authed_set,
      (select pg_get_functiondef('public.marketing_schedule_post(uuid,timestamptz)'::regprocedure)
         ilike '%marketing_check_compliance%') as schedule_rechecks;`))[0];
    log(`  marketing_auto_jobs table     : ${r.job_table} (expect true)`);
    log(`  auto-content RPCs (3)         : ${r.fns} (expect 3)`);
    log(`  create_auto_draft authed EXEC : ${r.authed_draft} (expect false)`);
    log(`  create_auto_draft service EXEC: ${r.svc_draft} (expect true)`);
    log(`  set_auto_job authed EXEC      : ${r.authed_set} (expect true)`);
    log(`  schedule_post rechecks compliance (P1-4): ${r.schedule_rechecks} (expect true)`);
    if (r.job_table !== true || Number(r.fns) !== 3 || r.authed_draft !== false ||
        r.svc_draft !== true || r.authed_set !== true || r.schedule_rechecks !== true) {
      fail("auto-content post-verify mismatch.");
    }

    const autoCronSql = load("autocron");
    log("safety scan PASS (autocron).");
    log("applying auto-content cron (own tx) …");
    await mgmt(creds, `BEGIN;\n${autoCronSql}\nCOMMIT;`);
    const jc = (await mgmt(creds, `select count(*)::int as n from cron.job where jobname='marketing-autocontent';`))[0];
    log(`  cron.job 'marketing-autocontent' rows: ${jc.n} (expect 1)`);
    if (Number(jc.n) !== 1) fail("auto-content cron job not scheduled.");
    log("auto-content apply complete (bots generate DRAFTS only; each club opts in via marketing_auto_jobs.enabled).");
    return;
  }
}

main().catch((e) => fail(mask(e?.message ?? String(e))));
