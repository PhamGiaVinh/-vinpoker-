import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPackage,atomicSql,baseline36ArraySql} from './floor-37-47-release-plan.mjs';
const project='orlesggcjamwuknxwcpk';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function validateContext(env,receipt,now=Date.now()){
 if(['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'].some(key=>env[key]))throw Error('Alternate libpq target/options rejected');
 const sha=env.RELEASE_SHA;
 if(!/^[a-f0-9]{40}$/.test(sha??'')||sha!==env.SOURCE_CHECKOUT_SHA||! /^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_ACTIONS!=='true'
  ||env.INITIAL_ACTOR!==env.REPOSITORY_OWNER||env.TRIGGERING_ACTOR!==env.REPOSITORY_OWNER
  ||!env.REPOSITORY_OWNER||env.SUPABASE_PROJECT_REF!==project
  ||env.PGHOST!=='aws-1-ap-southeast-2.pooler.supabase.com'||String(env.PGPORT)!=='5432'
  ||env.PGUSER!==`postgres.${project}`||env.PGDATABASE!=='postgres'||env.PGSSLMODE!=='require'||!env.PGPASSWORD)
  throw Error('Protected exact source/actor/connection context failed');
 const snapshot=Date.parse(receipt?.snapshotAt);
 if(receipt?.schemaVersion!==1||receipt.kind!=='vinpoker-restore-verification'
  ||receipt.sourceSha!==env.RECOVERY_BASE_SHA||! /^[a-f0-9]{40}$/.test(env.RECOVERY_BASE_SHA??'')
  ||receipt.isolatedRestore!=='PASS'||receipt.tableCountMatch!=='PASS'||receipt.productionMutation!==false
  ||! /^[a-f0-9]{64}$/.test(receipt.ciphertextSha256??'')||!Number.isFinite(snapshot)||snapshot>now||now-snapshot>3600000)
  throw Error('Fresh restore-verified recovery receipt failed');
}
export function psqlEnvironment(env){
 // Do not inherit libpq service/hostaddr/options/session overrides.
 const controlled=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('PG')));
 for(const key of ['PGHOST','PGPORT','PGUSER','PGDATABASE','PGSSLMODE','PGPASSWORD'])controlled[key]=env[key];
 return controlled;
}
export function preflightSql(){
 return `BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SELECT json_build_object(
 'database',current_database(),'actor',current_user,
 'pending',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20270128000037' AND '20270128000047'),
 'names',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name IN (${loadPackage().map(x=>`'${x.name}'`).join(',')})),
 'baseline',(SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20270128000036' AND name='floor_manual_entry_roundtrip_v1' AND ARRAY(SELECT replace(replace(s,E'\\r\\n',E'\\n'),E'\\r',E'\\n') FROM unnest(statements) WITH ORDINALITY x(s,n) ORDER BY n)=${baseline36ArraySql()})
 )::text;COMMIT;`;
}
export function classifyPreflight(row){
 if(row?.database!=='postgres'||row.actor!=='postgres'||row.pending!==0||row.names!==0||row.baseline!==true)
  throw Error('Live precondition drift or partial/existing package; stop without apply');
}
export function receiptSql(item){
 return `BEGIN READ ONLY;SELECT json_build_object('count',count(*),'exact',COALESCE(bool_and(name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}'),false))::text FROM supabase_migrations.schema_migrations WHERE version='${item.version}';COMMIT;`;
}
export function executePackage(transport,report=()=>{}){
 classifyPreflight(transport.json(preflightSql()));
 for(const item of loadPackage()){
  try{transport.execute(atomicSql(item));}
  catch{
   let observed='unavailable';
   try{const r=transport.json(receiptSql(item));observed=r.count===1&&r.exact===true?'committed-exact':r.count===0?'not-recorded':'drift';}catch{}
   report(`STOP ${item.version} receipt=${observed}; no retry or downstream apply`);
   throw Error(`Apply outcome requires review at ${item.version}`);
  }
  const r=transport.json(receiptSql(item));
  if(r.count!==1||r.exact!==true)throw Error(`Post-receipt drift at ${item.version}; stop`);
  report(`COMMITTED_EXACT ${item.version} ${item.hash}`);
 }
 transport.execute(readFileSync(resolve(root,'tests/floorProduction/package37_47.readonly-postcheck.sql'),'utf8'));
 report('PACKAGE_OBJECT_POSTCHECK_PASS');
}
function main(){
 const mode=process.argv[2];if(!['plan','apply'].includes(mode))throw Error('Protected plan|apply only');
 validateContext(process.env,JSON.parse(readFileSync(process.env.RECOVERY_RECEIPT_PATH,'utf8')));
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(head.status!==0||head.stdout.trim()!==process.env.RELEASE_SHA)throw Error('Checkout SHA differs');
 const query=sql=>{
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:psqlEnvironment(process.env),maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('psql failed; raw output withheld');return r.stdout.trim();
 };
 const transport={execute:query,json:sql=>JSON.parse(query(sql).split('\n').find(x=>x.startsWith('{')))};
 if(mode==='plan'){classifyPreflight(transport.json(preflightSql()));console.log('EXACT_PACKAGE_PENDING 37..47');return;}
 if(process.env.CONFIRM_FLOOR_PACKAGE!==`APPLY_FLOOR_37_47_${process.env.RELEASE_SHA}`)throw Error('Exact package confirmation missing');
 executePackage(transport,x=>console.log(x));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
