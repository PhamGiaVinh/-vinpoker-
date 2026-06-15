// tests/onlinePoker/ge2Readiness.test.ts
// The GE-2 Phase D readiness reporter must be safe: it prints NO secret values, it
// FAILS CLOSED when prerequisites are missing, and it REFUSES to "proceed" unless the
// exact owner gate phrase is given. Driven as a subprocess (the real CLI) so we test
// end-to-end behaviour without importing the .mjs into TypeScript.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SCRIPT = resolve(fileURLToPath(import.meta.url), '../../../scripts/ge2-readiness-report.mjs');
const GATE = 'Proceed with G4 DB enable drill';

/** Run the reporter; returns { code, out }. Never throws (captures non-zero exits). */
function run(args: string[], extraEnv: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const ALL_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon-xxxx',
  P1_EMAIL: 'p1@test', P1_PASSWORD: 'pw1', P2_EMAIL: 'p2@test', P2_PASSWORD: 'pw2',
  SUPABASE_DB_PASSWORD: 'dbpw',
};
const EMPTY_ENV: Record<string, string> = Object.fromEntries(Object.keys(ALL_ENV).map((k) => [k, '']));

describe('ge2-readiness-report — never prints secret values', () => {
  it('omits secret env VALUES from the markdown output', () => {
    const SECRET = 'S3CR3T_dbpw_zzz999';
    const ANON = 'anonkey_abc123_should_not_print';
    const { out } = run([], { ...EMPTY_ENV, SUPABASE_DB_PASSWORD: SECRET, SUPABASE_ANON_KEY: ANON });
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ANON);
    // it still reports presence by NAME
    expect(out).toContain('SUPABASE_DB_PASSWORD');
  });
});

describe('ge2-readiness-report — fails closed', () => {
  it('proceed=NO and prereqs pending when the env is missing', () => {
    const { out } = run(['--json'], EMPTY_ENV);
    const j = JSON.parse(out);
    expect(j.prereqReady).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('source/dark-state pack is healthy in-repo (exit 0)', () => {
    const { code, out } = run(['--json'], EMPTY_ENV);
    const j = JSON.parse(out);
    expect(j.sourceReady).toBe(true); // the repo IS dark + all source present
    expect(code).toBe(0);
  });
});

describe('ge2-readiness-report — refuses to proceed without the exact gate phrase', () => {
  it('no gate phrase ⇒ gateGiven=false, proceed=false (even with env present)', () => {
    const j = JSON.parse(run(['--json'], ALL_ENV).out);
    expect(j.gateGiven).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('a WRONG phrase is refused', () => {
    const j = JSON.parse(run(['--json', 'please', 'enable', 'poker'], ALL_ENV).out);
    expect(j.gateGiven).toBe(false);
    expect(j.proceed).toBe(false);
  });

  it('the EXACT phrase is recognised (gateGiven=true)', () => {
    const j = JSON.parse(run(['--json', GATE], ALL_ENV).out);
    expect(j.gateGiven).toBe(true);
    // proceed still depends on the local secret files existing (absent here), so we
    // only assert the phrase was accepted — never that it auto-proceeds.
  });
});
