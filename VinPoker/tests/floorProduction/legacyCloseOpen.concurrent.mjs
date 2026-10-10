import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Same psql/pg_stat_activity barrier pattern as trackerRosterIntent.concurrent.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(query) {
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function transaction(name, query, hold) {
  const process = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', error = '';
  const result = new Promise(resolve => {
    process.stdout.on('data', chunk => out += chunk);
    process.stderr.on('data', chunk => error += chunk);
    process.on('close', code => resolve({ code, out, error }));
    process.on('error', cause => resolve({ code: -1, error: String(cause) }));
  });
  process.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';${query}\n`);
  if (!hold) process.stdin.end('COMMIT;\n');
  return { result, send: query => process.stdin.write(`${query}\n`), commit: () => process.stdin.end('COMMIT;\n') };
}
async function barrier(name, condition) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`actual overlap barrier missing: ${name}`);
}
const prefix = randomUUID().slice(0, 8);
const actor = `${prefix}-0000-4000-8000-000000000001`;
const tour = `${prefix}-0000-4000-8000-000000000003`;
const physical = `${prefix}-0000-4000-8000-000000000011`;
const legacyTable = `${prefix}-0000-4000-8000-000000000021`;
const fixture = readFileSync('tests/floorProduction/legacySessionLifecycle.pg17.sql', 'utf8')
  .split('-- Positive control:')[0].replaceAll('f7460000', prefix);
sql(`${fixture}
INSERT INTO public.tournament_tables(id,tournament_id,table_id,table_name,table_number,max_seats,status)
VALUES('${legacyTable}','${tour}','${physical}','Pre-session legacy TEST',91,9,'active');COMMIT;`);
const blocker = transaction(`legacy_open_a_${prefix}`, `SELECT id FROM public.tournaments WHERE id='${tour}' FOR UPDATE;`, true);
await barrier(`legacy_open_a_${prefix}`, "state='idle in transaction'");
const close = transaction(`legacy_close_b_${prefix}`, `SELECT set_config('request.jwt.claim.sub','${actor}',true);
SET LOCAL ROLE authenticated;SELECT public.close_tournament_table('${legacyTable}','fill_lowest_table','overlap TEST');`, false);
await barrier(`legacy_close_b_${prefix}`, "wait_event_type='Lock'");
blocker.send(`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;
SELECT public.floor_open_tournament_table_v3('${tour}','${physical}','manual','${randomUUID()}');`);
blocker.commit();
const [opened, denied] = await Promise.all([blocker.result, close.result]);
assert.equal(opened.code, 0, opened.error);
assert.match(opened.out, /"ok": true/, 'public open must actually succeed');
assert.equal(denied.code, 0, denied.error);
assert.match(denied.out, /exact_session_required/);
assert.equal(sql(`SELECT status FROM public.tournament_tables WHERE id='${legacyTable}';`), 'active');
assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE game_table_id='${physical}' AND closed_at IS NULL;`), '1');
assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${tour}';`), '0');
console.log('LEGACY_CLOSE_OPEN_TRUE_OVERLAP_PASS');
