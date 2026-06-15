#!/usr/bin/env node
// scripts/ge2-table-runner-dryrun.mjs
// ─────────────────────────────────────────────────────────────────────────────
// GE-2K table-runner DRY-RUN harness (Phase-D tool; safe while dark).
//
// Calls the online-poker-table-runner Edge in dryRun mode and prints the eligibility
// report. It NEVER deals (dryRun=true), NEVER mutates, and NEVER prints secret VALUES
// (env is read by NAME only). While the runtime is DARK the Edge returns
// {outcome:'disabled'} and this reports "0 eligible".
//
// Env (names only — values never printed): SUPABASE_URL, OP_TABLE_RUNNER_SECRET.
// Usage: node scripts/ge2-table-runner-dryrun.mjs
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED = ['SUPABASE_URL', 'OP_TABLE_RUNNER_SECRET'];
const missing = REQUIRED.filter((n) => !process.env[n]);
if (missing.length) {
  console.log('GE-2K dry-run: missing env (names only):', missing.join(', '));
  console.log('Cannot reach the runner Edge — expected while dark / pre-deploy. No action taken.');
  process.exit(0);
}

const base = process.env.SUPABASE_URL.replace(/\/$/, '');
const endpoint = `${base}/functions/v1/online-poker-table-runner`;

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // secret used as the Bearer; never logged
      Authorization: `Bearer ${process.env.OP_TABLE_RUNNER_SECRET}`,
    },
    body: JSON.stringify({ dryRun: true }),
  });
  const data = await res.json().catch(() => ({}));

  // Print ONLY non-secret report fields.
  const report = {
    httpStatus: res.status,
    outcome: data.outcome,
    dryRun: data.dryRun,
    eligible: data.diag?.eligible ?? data.scanned ?? 0,
    skipped: data.diag
      ? { active_hand: data.diag.active_hand, no_quorum: data.diag.no_quorum, cooldown: data.diag.cooldown }
      : undefined,
  };
  console.log('GE-2K table-runner DRY-RUN report (no mutation):');
  console.log(JSON.stringify(report, null, 2));
  if (data.outcome === 'disabled') {
    console.log('Runtime is DARK (online_poker_config.enabled=false) → 0 eligible, nothing dealt.');
  }
} catch (e) {
  console.log('GE-2K dry-run: could not reach the Edge (expected pre-deploy):', e?.message ?? 'fetch failed');
  process.exit(0);
}
