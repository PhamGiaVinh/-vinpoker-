import { pathToFileURL } from 'node:url';

const PROJECT = 'orlesggcjamwuknxwcpk';
const SECRET_NAME = 'PUBLIC_SPECTATOR_WORKER_SECRET';
export const STOP_SQL = `
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='public-spectator-v2-dispatch';
REVOKE EXECUTE ON FUNCTION public.claim_public_spectator_projection_v2(integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb) FROM service_role;
UPDATE spectator_projection_v2.work_groups SET fencing_token=NULL,claimed_until=NULL;
`;

export async function run(mode, env = process.env, fetcher = fetch) {
  if (!['prepare', 'activate', 'stop'].includes(mode)) throw new Error('invalid_mode');
  if (env.SUPABASE_PROJECT_REF !== PROJECT || !env.SUPABASE_ACCESS_TOKEN) throw new Error('invalid_project_or_credentials');
  async function management(path, body) {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    // Never echo response bodies: Vault/API responses can contain credentials.
    if (!response.ok) throw new Error(`management_${response.status}`);
    return response.json();
  }
  const sql = (query) => management('database/query', { query });
  if (mode === 'stop') {
    await sql(STOP_SQL);
    return { stopped: true };
  }
  const preflight = await sql(`SELECT to_regprocedure('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)') IS NOT NULL AND COALESCE((SELECT trim(p.prosrc)='SELECT 2' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='spectator_projection_v2' AND p.proname='read_contract_version'),false) AS ready;`);
  if (preflight[0]?.ready !== true) throw new Error('migration_missing');
  if (mode === 'prepare') {
    // Generate inside Vault so neither the query nor a source file contains a secret.
    await sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='${SECRET_NAME}') THEN PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'${SECRET_NAME}','Dedicated spectator worker'); END IF; END $$;`);
  }
  const rows = await sql(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='${SECRET_NAME}';`);
  const secret = rows.length === 1 ? rows[0].decrypted_secret : null;
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('worker_secret_missing');
  if (mode === 'prepare') {
    await management('secrets', [{ name: SECRET_NAME, value: secret }]);
    return { prepared: true };
  }
  await sql(`GRANT EXECUTE ON FUNCTION public.claim_public_spectator_projection_v2(integer) TO service_role; GRANT EXECUTE ON FUNCTION public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb) TO service_role;`);
  const workerUrl = `https://${PROJECT}.supabase.co/functions/v1/public-spectator-projector-v2`;
  const denied = await fetcher(workerUrl, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (denied.status !== 401) throw new Error('worker_auth_not_enforced');
  const drainDeadline = Date.now() + 60_000;
  for (;;) {
    const response = await fetcher(workerUrl, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`worker_${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.results) || result.results.some((item) => item.error)) throw new Error('worker_projection_failed');
    const pending = await sql(`SELECT count(*)::integer AS pending FROM spectator_projection_v2.work_groups;`);
    if (pending[0]?.pending === 0) break;
    if (Date.now() >= drainDeadline) throw new Error('projection_backlog_not_drained');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  await sql(`SELECT cron.schedule('public-spectator-v2-dispatch','1 second','SELECT public.dispatch_public_spectator_projection_v2()');`);
  return { activated: true, dispatcher: 'public-spectator-v2-dispatch' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2]).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    // Only our fixed error codes are emitted; never include SDK/request bodies.
    console.error(/^[a-z_]+(?:\d+)?$/.test(error.message) ? error.message : 'activation_failed');
    process.exitCode = 1;
  });
}
