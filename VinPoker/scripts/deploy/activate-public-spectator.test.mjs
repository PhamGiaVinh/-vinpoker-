import test from 'node:test';
import assert from 'node:assert/strict';
import { run, STOP_SQL } from './activate-public-spectator.mjs';

const env = { SUPABASE_PROJECT_REF: 'orlesggcjamwuknxwcpk', SUPABASE_ACCESS_TOKEN: 'test-only' };
test('starts cron only after denied guest probe, authorized worker, and drained backlog', async () => {
  const calls = [];
  const fake = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push(body.query ?? url);
    if (url.includes('/functions/')) return options.headers
      ? { ok: true, json: async () => ({ results: [{ published: true }] }) }
      : { status: 401 };
    const data = body.query?.includes('AS ready') ? [{ ready: true }]
      : body.query?.includes('decrypted_secret') ? [{ decrypted_secret: 'a'.repeat(64) }]
      : body.query?.includes('AS pending') ? [{ pending: 0 }] : [];
    return { ok: true, json: async () => data };
  };
  assert.deepEqual(await run('activate', env, fake), { activated: true, dispatcher: 'public-spectator-v2-dispatch' });
  assert.match(calls.at(-1), /cron.schedule/);
  assert.match(calls.at(-2), /AS pending/);
});
test('refuses another project before any network request', async () => {
  await assert.rejects(run('activate', { ...env, SUPABASE_PROJECT_REF: 'another' }, () => { throw new Error('unexpected request'); }), /invalid_project/);
});
test('does not start cron when worker authentication is broken', async () => {
  const calls = [];
  const fake = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push(body.query ?? url);
    const data = body.query?.includes('AS ready') ? [{ ready: true }] : body.query?.includes('decrypted_secret') ? [{ decrypted_secret: 'a'.repeat(64) }] : [];
    return { ok: true, status: 200, json: async () => data };
  };
  await assert.rejects(run('activate', env, fake), /worker_auth_not_enforced/);
  assert.equal(calls.some((value) => value.includes('cron.schedule')), false);
});
test('stop fences publication and leaves business data untouched', async () => {
  const calls = [];
  await run('stop', env, async (_url, options) => { calls.push(JSON.parse(options.body).query); return { ok: true, json: async () => [] }; });
  assert.deepEqual(calls, [STOP_SQL]);
  assert.match(STOP_SQL, /REVOKE EXECUTE.*publish_public_spectator/);
  assert.doesNotMatch(STOP_SQL, /(UPDATE|DELETE FROM) public\./);
});
