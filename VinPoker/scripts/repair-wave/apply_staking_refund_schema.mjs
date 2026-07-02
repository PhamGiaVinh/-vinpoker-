#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// REPAIR WAVE R3 — staking refund schema (enum + columns), owner-gated
// ════════════════════════════════════════════════════════════════════════════
// Same runner pattern as apply_finance_pt_wage.mjs / marketing. Two legs because Postgres cannot
// use a new enum value in the transaction that adds it:
//   --preflight     read-only: current enum labels + column existence
//   --apply-enum    gated: 20261212000000_staking_refund_enum.sql   (OWN Management-API call)
//   --apply-schema  gated: 20261212000001_staking_refund_schema.sql (separate call, after enum)
//   --verify        read-only: enum contains 'deal_refunded' + all 4 columns exist
// Gate: CONFIRM_APPLY_REPAIR=APPLY_STAKING_REFUND

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const FILES = {
  enum: "supabase/migrations/20261212000000_staking_refund_enum.sql",
  schema: "supabase/migrations/20261212000001_staking_refund_schema.sql",
};
const MARQUEE = {
  enum: /ALTER TYPE public\.staking_deal_status ADD VALUE IF NOT EXISTS 'deal_refunded'/,
  schema: /ALTER TABLE public\.staking_deals[\s\S]*ADD COLUMN IF NOT EXISTS refund_status/,
};
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "orlesggcjamwuknxwcpk";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const log = (...a) => console.log("[staking-schema]", ...a);
const fail = (...a) => { console.error("[staking-schema] ✗", ...a); process.exit(1); };
const mask = (s) => String(s).replace(/sbp_[A-Za-z0-9_]+|eyJ[A-Za-z0-9._-]{20,}/g, "***");

async function mgmt(query) {
  if (!TOKEN) fail("SUPABASE_ACCESS_TOKEN not set");
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) { fail("network error:", mask(e.message)); }
  if (!res.ok) fail(`Management API ${res.status}:`, mask(await res.text()));
  return res.json();
}
const rowsOf = (r) => (Array.isArray(r) ? r : (r.rows ?? []));

function lint(sql, which) {
  if (!MARQUEE[which].test(sql)) fail(`${which}: marquee missing — wrong file?`);
  const shell = sql.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''");
  for (const rx of [/\bdrop\s+/i, /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i, /\btrunc\w*\b/i, /schema_migrations/i]) {
    if (rx.test(shell)) fail(`${which}: lint refused ${rx}`);
  }
  log(`${which}: lint OK`);
}

const Q_STATE = `select
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
     join pg_type t on t.oid = e.enumtypid where t.typname = 'staking_deal_status') as labels,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='staking_deals'
       and column_name in ('refund_status','refund_reason','refunded_by','refunded_at')) as refund_cols`;

async function state() {
  const r = rowsOf(await mgmt(Q_STATE))[0];
  log(`enum labels: ${r.labels}`);
  log(`refund columns present: ${r.refund_cols}/4`);
  return { hasEnum: String(r.labels).includes("deal_refunded"), cols: Number(r.refund_cols) };
}

const mode = process.argv[2];
if (mode === "--preflight") {
  const s = await state();
  log(s.hasEnum && s.cols === 4 ? "already applied (idempotent re-run OK)" : "repair needed");
} else if (mode === "--apply-enum" || mode === "--apply-schema") {
  if (process.env.CONFIRM_APPLY_REPAIR !== "APPLY_STAKING_REFUND") fail("refusing: CONFIRM_APPLY_REPAIR != APPLY_STAKING_REFUND");
  const which = mode === "--apply-enum" ? "enum" : "schema";
  const sql = readFileSync(resolve(REPO_ROOT, FILES[which]), "utf8");
  lint(sql, which);
  await mgmt(sql);
  log(`${which} applied (own Management-API call).`);
} else if (mode === "--verify") {
  const s = await state();
  if (!s.hasEnum) fail("enum 'deal_refunded' still missing");
  if (s.cols !== 4) fail(`only ${s.cols}/4 refund columns present`);
  log("VERIFY PASS: enum + 4 columns live.");
} else fail("usage: --preflight | --apply-enum | --apply-schema | --verify");
