#!/usr/bin/env node
// scripts/ge2-readiness-report.mjs
// ─────────────────────────────────────────────────────────────────────────────
// GE-2 Phase D — READ-ONLY readiness reporter.
//
// What it DOES:  reads local SOURCE files + checks env var NAMES + checks whether
//   the local (gitignored) secret files exist, then prints a PASS/FAIL markdown
//   (or --json) report on whether a future Phase D drill is ready.
// What it NEVER does:  no network, no DB, no Supabase, no migration, no flag flip,
//   no enable, no deploy. It reads env var presence only — it NEVER reads or prints
//   a secret VALUE (no .env file contents are read; only existsSync). It enables
//   NOTHING: the gate phrase only flips a "gate satisfied" line, triggering no action.
//
// Usage:
//   node scripts/ge2-readiness-report.mjs                       # markdown report
//   node scripts/ge2-readiness-report.mjs --json                # machine-readable
//   node scripts/ge2-readiness-report.mjs "Proceed with G4 DB enable drill"  # gate check
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** The EXACT owner gate phrase. Anything else (incl. empty) refuses to proceed. */
export const GATE_PHRASE = 'Proceed with G4 DB enable drill';

/** Disposable-login + public env names the Edge-path drill needs (NEVER values). */
const PREREQ_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'P1_EMAIL', 'P1_PASSWORD', 'P2_EMAIL', 'P2_PASSWORD'];
/** DB-password env name (value is a SECRET — checked by NAME presence only). */
const DBPW_ENV = ['SUPABASE_DB_PASSWORD'];

const ck = (name, ok, kind = 'source') => ({ name, ok: !!ok, kind });

/**
 * Pure readiness evaluation. All side-effecting deps are injected so this is fully
 * testable without touching disk/env.
 *   read(rel) -> string|null   (source file contents)
 *   has(rel)  -> boolean        (file exists)
 *   env       -> { [name]: string }  (process.env-like; values are NEVER emitted)
 *   gatePhrase-> string
 */
export function buildReadinessReport({ read, has, env = {}, gatePhrase = '' }) {
  const envSet = (n) => typeof env[n] === 'string' && env[n].length > 0;
  const flags = read('src/lib/featureFlags.ts') ?? '';
  const types = read('src/lib/onlinePoker/types.ts') ?? '';
  const table = read('src/pages/OnlinePokerTable.tsx') ?? '';

  // A) SOURCE + DARK-STATE — must ALL pass for the readiness pack to be healthy.
  const source = [
    ck('FEATURES.onlinePoker is false (frontend gate off)', /onlinePoker:\s*false/.test(flags)),
    ck('RUNTIME_LIVE is false (in-shell gate off)', /export const RUNTIME_LIVE\s*=\s*false/.test(types)),
    ck('/poker table self-gates on FEATURES.onlinePoker (no live play to real users)',
      /if\s*\(\s*!FEATURES\.onlinePoker\s*\)\s*return\s*<PokerComingSoon/.test(table)),
    ck('Edge online-poker-action source present', has('supabase/functions/online-poker-action/index.ts')),
    ck('Action drill harness present', has('scripts/ge2-online-poker-drill.mjs')),
    ck('Timeout-sweep edge source present', has('supabase/functions/online-poker-timeout-sweep/index.ts')),
    ck('Timeout-sweep CRON migration source present (NOT assumed live — apply at Phase D)',
      has('supabase/migrations/20260903000000_online_poker_timeout_sweep_cron.sql')),
    ck('Player UI #197 (ActionBar) present', has('src/components/poker/ActionBar.tsx')),
    ck('Player UI #201 (SeatRing + CardBack) present',
      has('src/components/poker/SeatRing.tsx') && has('src/components/poker/CardBack.tsx')),
    ck('Player UI #202 (motion CSS) present', has('src/components/poker/pokerTable.css')),
    ck('Enablement runbook present', has('docs/engine/GE2_ENABLEMENT_RUNBOOK.md')),
    ck('Phase D readiness doc present', has('docs/online-poker/GE2_PHASE_D_READINESS.md')),
  ];

  // B) PHASE-D GATE PREREQUISITES — owner-supplied at drill time. PENDING is the
  //    expected state pre-gate; their absence is NOT a pack failure, but it (and a
  //    missing gate phrase) keeps `proceed` = false (fail-closed).
  const prereq = [
    ...PREREQ_ENV.map((n) => ck(`env ${n} present (name only)`, envSet(n), 'prereq')),
    ...DBPW_ENV.map((n) => ck(`env ${n} present (name only)`, envSet(n), 'prereq')),
    ck('disposable drill env file present (scripts/.env.ge2-drill.local)', has('scripts/.env.ge2-drill.local'), 'prereq'),
    ck('DB-password env file present (scripts/.env.test.local)', has('scripts/.env.test.local'), 'prereq'),
  ];

  const sourceReady = source.every((c) => c.ok);
  const prereqReady = prereq.every((c) => c.ok);
  const gateGiven = String(gatePhrase).trim() === GATE_PHRASE;
  // FAIL-CLOSED: only proceed when source is healthy AND every prerequisite is in
  // place AND the EXACT gate phrase was given. Missing anything ⇒ do NOT proceed.
  const proceed = sourceReady && prereqReady && gateGiven;

  return { source, prereq, sourceReady, prereqReady, gateGiven, proceed };
}

const mark = (c) => (c.ok ? '✅' : c.kind === 'prereq' ? '⏳' : '❌');

/** Render the report as PASS/FAIL markdown. Contains NO secret values (names only). */
export function toMarkdown(r) {
  const lines = [];
  lines.push('# GE-2 Phase D — Readiness Report');
  lines.push('');
  lines.push('> READ-ONLY. No DB/Edge/flag/migration touched. No secret values printed.');
  lines.push('');
  lines.push(`- **Readiness pack (source + dark-state):** ${r.sourceReady ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- **Phase-D prerequisites (owner-supplied):** ${r.prereqReady ? '✅ all present' : '⏳ pending'}`);
  lines.push(`- **Gate phrase (\`${GATE_PHRASE}\`):** ${r.gateGiven ? '✅ given' : '⛔ not given'}`);
  lines.push(`- **PROCEED with Phase D drill:** ${r.proceed ? '✅ YES' : '⛔ NO (blocked — fail-closed)'}`);
  lines.push('');
  lines.push('## A. Source & dark-state (must all pass)');
  for (const c of r.source) lines.push(`- ${mark(c)} ${c.name}`);
  lines.push('');
  lines.push('## B. Phase-D gate prerequisites (⏳ = pending, expected before the gate)');
  for (const c of r.prereq) lines.push(`- ${mark(c)} ${c.name}`);
  lines.push('');
  lines.push(r.proceed
    ? '**Verdict:** all gates satisfied — a Phase D drill MAY be run per docs/online-poker/GE2_PHASE_D_READINESS.md.'
    : '**Verdict:** Phase D is BLOCKED. This is expected until the owner supplies the prerequisites AND sends the exact gate phrase. Nothing here enables anything.');
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const gatePhrase = argv.filter((a) => !a.startsWith('--')).join(' ');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (rel) => { try { return readFileSync(resolve(repoRoot, rel), 'utf8'); } catch { return null; } };
  const has = (rel) => existsSync(resolve(repoRoot, rel));

  const r = buildReadinessReport({ read, has, env: process.env, gatePhrase });
  if (json) {
    console.log(JSON.stringify(
      { sourceReady: r.sourceReady, prereqReady: r.prereqReady, gateGiven: r.gateGiven, proceed: r.proceed },
      null, 2));
  } else {
    console.log(toMarkdown(r));
  }
  // Exit non-zero ONLY if the dark-state/source pack is broken (a real alarm).
  // Pending prerequisites / missing gate are expected ⇒ they do NOT fail the run.
  process.exitCode = r.sourceReady ? 0 : 1;
}

// Run only when invoked directly (so tests can import without side effects).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
