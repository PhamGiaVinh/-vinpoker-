import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {atomicSql,loadMigration,dependencyPredicate,postcheckSql} from './tracker-card-56-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
test('PG17 exact56 receipt failure rolls back bodies; success and replay fenced',{skip:process.env.CARD56_PG_TEST!=='1'},()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
 assert.ok(['vinpoker_ops_card56_atomic_20261011','vinpoker_ops_card56_atomic_20261011b'].includes(process.env.PGDATABASE));
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(check("SELECT current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
 const schema=readFileSync(resolve(process.env.SCHEMA_ARTIFACT_DIR,'live-public-schema.sql'),'utf8');
 assert.equal(createHash('sha256').update(schema).digest('hex'),'d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a');
 // Restore only reviewed predecessor definitions; never replay the schema or archive.
 const predecessors=[];
 for(const name of ['show_hole_cards','update_community_cards']){
  const start=schema.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"(`);
  assert.ok(start>=0);const body=schema.indexOf('AS $$',start),end=schema.indexOf('$$;',body+5);
  assert.ok(body>start&&end>body);const definition=schema.slice(start,end+3);
  predecessors.push(definition);check(definition);
 }
 assert.equal(check(`SELECT ${dependencyPredicate()};`),'t');
 const snapshot="SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig) ORDER BY p.oid)::text FROM pg_proc p WHERE p.oid IN ('public.show_hole_cards(uuid,jsonb,uuid)'::regprocedure,'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure);";
 const before=check(snapshot);
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION public.reject56_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='20270128000056' THEN RAISE EXCEPTION 'injected56_receipt_failure';END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject56 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject56_receipt();`);
 const failed=query(atomicSql());assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected56_receipt_failure/);
 assert.equal(check(snapshot),before,'both bodies and authority metadata roll back');
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:0,exact:false});
 check('DROP TRIGGER reject56 ON supabase_migrations.schema_migrations;DROP FUNCTION public.reject56_receipt();');
 check(atomicSql());check(postcheckSql());
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 const replay=query(atomicSql());assert.notEqual(replay.status,0);assert.match(replay.stderr,/card56_precondition_drift/);
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true});
 // Rehearse the compensating definition restoration, not deletion of a receipt.
 // A live rollback must receive its own reviewed forward migration/version.
 check('BEGIN;'+predecessors.join('\n')+'COMMIT;');
 assert.equal(check(snapshot),before,'compensation restores original bodies and authority');
 assert.deepEqual(JSON.parse(check(receiptSql(loadMigration()))),{count:1,exact:true},'original apply audit remains');
 console.log('CARD56_ATOMIC_ROLLBACK_RECEIPT_OBJECT_REPLAY_PASS');
});
