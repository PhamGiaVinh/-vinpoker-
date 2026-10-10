import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadPackage,atomicSql} from './floor-49-50-release-plan.mjs';
import {loadPackage as load37to47} from './floor-37-47-release-plan.mjs';
import {loadMigration as load48} from './floor-48-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {postcheckSql} from './floor-49-50-protected-apply.mjs';
export function assertLocalTransport(database,platform=process.platform,env=process.env){
 assert.match(database,/^vinpoker_ops_atomic49_[a-z0-9_]+$/);
 if(platform!=='win32'){
  assert.equal(env.PGHOST,'127.0.0.1');assert.equal(String(env.PGPORT),'5432');
  assert.equal(env.PGUSER,'postgres');assert.equal(env.PGDATABASE,database);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!env[key],`${key} override forbidden`);
 }
}
test('Linux atomic test transport rejects remote/alternate targets',()=>{
 const database='vinpoker_ops_atomic49_ci';
 const env={PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:database};
 assertLocalTransport(database,'linux',env);
 for(const changed of [{PGHOST:'remote.example'},{PGPORT:'6543'},{PGUSER:'other'},{PGDATABASE:'postgres'},{PGHOSTADDR:'remote'},{PGOPTIONS:'override'}])assert.throws(()=>assertLocalTransport(database,'linux',{...env,...changed}));
});
test('PG17 exact49 receipt failure rolls back all objects; commit/replay and50 guard',{
 skip:!process.env.FLOOR49_LOCAL_DATABASE,
},()=>{
 const database=process.env.FLOOR49_LOCAL_DATABASE;
 assertLocalTransport(database);
 const args=['-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const query=sql=>process.platform==='win32'
  ? spawnSync('wsl',['sudo','-n','-u','postgres','psql',...args],{input:sql,encoding:'utf8',maxBuffer:2*1024*1024})
  : spawnSync('psql',args,{input:sql,encoding:'utf8',maxBuffer:2*1024*1024});
 const check=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 // Docker port forwarding keeps the client target loopback, but the server
 // reports its internal bridge address. Transport is constrained above.
 const intactSql=`SELECT current_database()='${database}' AND current_user='postgres' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND to_regprocedure('floor_private.resolve_pending_table_modes_v1(integer)') IS NULL
 AND to_regclass('floor_private.table_mode_retry_cursor_v1') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_mode_tournament_lifecycle_v1')
 AND md5(replace(pg_get_functiondef('public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)'::regprocedure),chr(13),''))='6eee12a1f821d289d672e5045a55d8da';`;
 assert.equal(check(intactSql),'t','fresh isolated mode13 predecessor required');
 assert.equal(check("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;"),'t');
 const predecessors=[...load37to47(),load48()];
 check(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE SCHEMA extensions;CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS 'SELECT public.digest($1,$2)';
 ${predecessors.map((item,i)=>`INSERT INTO supabase_migrations.schema_migrations VALUES('${item.version}','${item.name}',ARRAY[$seed${i}$${item.sql}$seed${i}$]);`).join('\n')}
 CREATE FUNCTION floor_private.reject49_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='20270128000049' THEN RAISE EXCEPTION 'injected49_receipt_failure'; END IF;RETURN NEW;END $$;
 CREATE TRIGGER reject49 BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION floor_private.reject49_receipt();`);
 const [item49,item50]=loadPackage();
 const failed=query(atomicSql(item49));
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected49_receipt_failure/);
 assert.equal(check(intactSql),'t','all49 function/table/trigger changes must rollback');
 assert.deepEqual(JSON.parse(check(receiptSql(item49))),{count:0,exact:false});
 check('DROP TRIGGER reject49 ON supabase_migrations.schema_migrations;DROP FUNCTION floor_private.reject49_receipt();');
 check(atomicSql(item49));
 assert.deepEqual(JSON.parse(check(receiptSql(item49))),{count:1,exact:true});
 assert.deepEqual(JSON.parse(check(postcheckSql(item49.version))),{functions:true,cursor:true,cursor_row:true,trigger:true,scheduler:true});
 const replay=query(atomicSql(item49));assert.notEqual(replay.status,0);assert.match(replay.stderr,/floor49_50_receipt_exists_stop/);
 assert.equal(check("SELECT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron');"),'t','this fixture tests missing-cron refusal only');
 const noCron=query(atomicSql(item50));assert.notEqual(noCron.status,0);assert.match(noCron.stderr,/floor50_pg_cron_required/);
 assert.deepEqual(JSON.parse(check(receiptSql(item50))),{count:0,exact:false});
 assert.deepEqual(JSON.parse(check(receiptSql(item49))),{count:1,exact:true});
 console.log(`LOCAL49_ATOMIC_ROLLBACK_RECEIPT_POSTCHECK_PASS ${database}; NOT live or cron runtime proof`);
});
