import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,dependencyPredicate} from './tracker-history-58-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 history58 receipt failure rolls back all DDL and replay is fenced',
 {skip:process.env.HISTORY58_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.equal(process.env.PGDATABASE,'vinpoker_ops_identity58_atomic_20261011');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const query=sql=>spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
 assert.equal(check(`SELECT ${dependencyPredicate()};`),'t');
 const snapshot=`SELECT jsonb_build_object('triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(oid),'enabled',tgenabled) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND NOT tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.tracker_bump_hand_source_revision()'),to_regprocedure('floor_private.bump_hand_identity_revision_v1()'),to_regprocedure('floor_private.invalidate_new_hand_identity_chain_v1()'))))::text;`;
 const before=check(snapshot);
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION public.reject58_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='20270128000058' THEN RAISE EXCEPTION 'injected58_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject58 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject58_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected58_receipt_failure/);
 assert.equal(check(snapshot),before);
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
 check('DROP TRIGGER reject58 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject58_receipt();');
 check(atomicSql());
 check(readFileSync(new URL('../../tests/trackerSettlement/handIdentityRevision.readonly-postcheck.sql',import.meta.url),'utf8'));
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 const applied=check(snapshot),replay=query(atomicSql());
 assert.notEqual(replay.status,0);assert.match(replay.stderr,/history58_precondition_drift/);
 assert.equal(check(snapshot),applied);
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 console.log('HISTORY58_ATOMIC_ROLLBACK_RECEIPT_OBJECT_REPLAY_PASS');
});
