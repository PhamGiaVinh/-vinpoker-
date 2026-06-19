#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// B2.2a controlled apply — lock-fencing DB foundation (migration 20261003000000).
// ONE-SHOT, owner-gated. preflight (read-only) → confirm-gate → idempotent apply →
// post-verify. Additive + backward-compatible; legacy lock functions untouched.
// ════════════════════════════════════════════════════════════════════════════
// • Credentials ONLY from env: SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN
//   (GitHub Secrets via the workflow). Tokens masked in all output; never printed.
// • Preflight runs always (read-only). APPLY happens only if
//   CONFIRM_B22A === 'APPLY_LOCK_FENCING_B22A' (fail-closed).
// • Applies the EXACT committed migration file (BEGIN/COMMIT stripped — the
//   Management API wraps the batch). Idempotent (ADD COLUMN IF NOT EXISTS /
//   CREATE OR REPLACE / GRANT) so a re-run is safe.
// • Does NOT write supabase_migrations.schema_migrations (verified post-apply).
// • No db push, no deploy_db. Rollback: docs/emergency_rollbacks/PRE_20261003_*.sql
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";

const log = (...a) => console.log("[b22a]", ...a);
const fail = (...a) => { console.error("[b22a] ✗", ...a); process.exit(1); };

function mask(s) {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "sbp_****")
    .replace(/sb_secret_[A-Za-z0-9]+/g, "sb_secret_****")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://****@")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1****");
}

const MIGRATION_PATH = "supabase/migrations/20261003000000_lock_fencing_foundation.sql";
const CONFIRM_PHRASE = "APPLY_LOCK_FENCING_B22A";

const PREFLIGHT = [
  {
    label: "P1 — fencing columns on club_processing_locks (pre: absent / post: 3)",
    sql: `select column_name from information_schema.columns
          where table_schema='public' and table_name='club_processing_locks'
            and column_name in ('lock_token','owner_id','last_heartbeat_at')
          order by 1;`,
  },
  {
    label: "P2 — new fencing functions (pre: absent / post: 3)",
    sql: `select p.proname, pg_get_function_identity_arguments(p.oid) as args
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public'
            and p.proname in ('try_acquire_club_lock_fenced','extend_club_lock_lease','release_club_lock_if_owner')
          order by 1, 2;`,
  },
  {
    label: "P3 — legacy lock function bodies md5 (must be UNCHANGED post-apply)",
    sql: `select p.proname, md5(pg_get_functiondef(p.oid)) as body_md5
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public'
            and p.proname in ('try_acquire_club_lock','release_club_lock','cleanup_expired_club_locks')
          order by 1;`,
  },
];

const VERIFY = [
  ...PREFLIGHT,
  {
    label: "V4 — grants: service_role EXECUTE on the 3 new functions (expect true×3)",
    sql: `select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public'
            and p.proname in ('try_acquire_club_lock_fenced','extend_club_lock_lease','release_club_lock_if_owner')
          order by 1;`,
  },
  {
    label: "V5 — schema_migrations NOT written for 20261003000000 (expect n=0)",
    sql: `select count(*)::int as n from supabase_migrations.schema_migrations where version='20261003000000';`,
  },
];

// Read-only guard for preflight/verify SELECTs (apply SQL bypasses this intentionally).
function assertReadOnly(label, sql) {
  const s = sql.replace(/--[^\n]*/g, " ");
  if (!/^\s*(with|select)\b/i.test(s)) fail(`query "${label}" is not read-only`);
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|merge)\b/i.test(s)) {
    fail(`query "${label}" contains a write keyword`);
  }
}

async function mgmtQuery(creds, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${creds.ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${mask(await res.text())}`);
  return res.json();
}

async function runSet(creds, queries) {
  for (const q of queries) {
    assertReadOnly(q.label, q.sql);
    log("──────────────────────────────────────────────");
    log(q.label);
    console.log(JSON.stringify(await mgmtQuery(creds, q.sql), null, 2));
  }
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    log("no credentials present — NOTHING contacted. Set SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN.");
    process.exit(0);
  }
  const creds = { ref, token };

  log("════════ PREFLIGHT (read-only) ════════");
  await runSet(creds, PREFLIGHT);

  if (process.env.CONFIRM_B22A !== CONFIRM_PHRASE) {
    log("══════════════════════════════════════════════");
    log(`DRY RUN — apply skipped. To apply, set CONFIRM_B22A='${CONFIRM_PHRASE}'.`);
    process.exit(0);
  }

  // APPLY — the committed migration, BEGIN/COMMIT stripped (Management API wraps the batch).
  let sql = readFileSync(MIGRATION_PATH, "utf8");
  sql = sql.replace(/^\s*BEGIN;\s*$/gim, "").replace(/^\s*COMMIT;\s*$/gim, "");
  log("════════ APPLY (migration 20261003000000, idempotent) ════════");
  const applyRes = await mgmtQuery(creds, sql);
  console.log(JSON.stringify(applyRes, null, 2));

  log("════════ POST-VERIFY ════════");
  await runSet(creds, VERIFY);

  log("══════════════════════════════════════════════");
  log("APPLY COMPLETE. Confirm in the output above:");
  log("  • P1 now lists lock_token + owner_id + last_heartbeat_at (3)");
  log("  • P2 now lists the 3 new functions");
  log("  • P3 legacy md5 IDENTICAL to the PREFLIGHT P3 (legacy untouched)");
  log("  • V4 service_role_exec = true ×3");
  log("  • V5 n = 0 (schema_migrations NOT written)");
  log("Report lines → schema_migrations changed: NO · db push: NO · deploy_db: NO · secrets exposed: NO");
}

main().catch((e) => fail(mask(e.message)));
