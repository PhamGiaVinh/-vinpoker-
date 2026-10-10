// Offline allowlist/atomic-SQL preparation only. No network or execution path.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const entries=[
 ['37','floor_legacy_close_session_fence_v1','13766d88de0765d7fdebb0edf89f250af2ecf34e226c2e2146148bd85e497c3c'],
 ['38','floor_break_lowest_number_policy_v1','657c1db3b3773dad47f070aa1a5d4757dfe2b30077f602075499bd81814b4721'],
 ['39','floor_break_ticket_audit_v1','451788264693a09342660306a58806853b269a2aca08c3415ce2506865359f4a'],
 ['40','floor_break_balanced_plan_v1','360647f7766261b6f063af6efb07b5b003456f74f842ca035c1e8954dc570d38'],
 ['41','floor_deferred_move_ticket_audit_v1','377269df73038faf401649c63de2790146d009635228793138a88511b3dc5ba8'],
 ['42','floor_canonical_move_ticket_integrity_v1','70044e39df48a1515687d912eed1065d7f1c80b0e805a7418616a118a0cce28d'],
 ['43','floor_move_exact_intent_v1','f545d9cd37e7a6d8a59ad2ee392e3f72c551d3da5441839b2523502dfc6ae7dd'],
 ['44','floor_seat_ticket_read_v1','ac977694c020afba499abf360902129360aebc9873ec5d40791c85744c122d26'],
 ['45','floor_seat_ticket_select_scope_v1','46bdb1ee2dc1ce684e766c1d762265453cfb0f440e7c86f1227c543e422b8e59'],
 ['46','dealer_inventory_canonical_table_link_v1','70d5c8ace517321fb2a7ac0a26c7098619391fa2cdc504d7436a9d1225426358'],
 ['47','floor_closed_session_attendance_v1','68f37a501ee80408770f437553295271198222804bc58e978d6296eb54e61ad0']
];
export function loadPackage(sourceRoot=root){
 return entries.map(([suffix,name,hash])=>{
  const version=`202701280000${suffix}`,filename=`${version}_${name}.sql`;
  const sql=canonicalSqlText(readFileSync(resolve(sourceRoot,'supabase/migrations',filename),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash)throw Error(`SQL drift ${version}`);
  if(scanMigrationSource(sql).mode!=='outer-transaction')throw Error(`Transaction shape ${version}`);
  return {version,name,hash,filename,sql};
 });
}
export function baseline36Statements(){
 const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations/20270128000036_floor_manual_entry_roundtrip_v1.sql'),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!=='306474110038315a5477b5e712067c831003b26cec60fc34375896c87baa05d5')throw Error('Baseline36 source drift');
 // Exact reviewed source segmentation matches the six live CLI receipt hashes.
 const parts=sql.split(/(?<=;)\n(?=SET LOCAL|DO |COMMIT;)/).map(x=>x.trim().replace(/;$/,''));
 if(parts.length!==6||parts.some(x=>x.includes('$baseline36$')))throw Error('Baseline36 receipt shape');
 return parts;
}
export function baseline36ArraySql(){return `ARRAY[${baseline36Statements().map(x=>`$baseline36$${x}$baseline36$`).join(',')}]::text[]`;}
export function atomicSql(item){
 const canonical=loadPackage().find(x=>x.version===item.version);
 if(!canonical||canonical.sql!==item.sql||canonical.name!==item.name||canonical.hash!==item.hash)throw Error('Not exact allowlist entry');
 const scan=scanMigrationSource(item.sql),tag='$floor_37_47_receipt$';
 if(item.sql.includes(tag))throw Error('Receipt delimiter collision');
 const index=entries.findIndex(x=>`202701280000${x[0]}`===item.version);
 const [suffix,previousName,previousHash]=index===0
  ? ['36','floor_manual_entry_roundtrip_v1','306474110038315a5477b5e712067c831003b26cec60fc34375896c87baa05d5']
  : entries[index-1];
 const receiptPredicate=index===0
  ? `cardinality(statements)=6 AND ARRAY(SELECT replace(replace(s,E'\\r\\n',E'\\n'),E'\\r',E'\\n') FROM unnest(statements) WITH ORDINALITY AS x(s,n) ORDER BY n)=${baseline36ArraySql()}`
  : `cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${previousHash}'`;
 const guard=`SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\nSELECT pg_advisory_xact_lock(280000,3747);\nDO $floor_37_47_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}') THEN RAISE EXCEPTION 'floor_package_receipt_exists_stop'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='202701280000${suffix}' AND name='${previousName}' AND ${receiptPredicate}) THEN RAISE EXCEPTION 'floor_package_predecessor_drift'; END IF;
 END $floor_37_47_guard$;\n`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);\n`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+item.sql.slice(scan.insertBeforeCommit);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('Offline plan only; no apply or SQL export command');
 for(const {version,name,hash} of loadPackage())console.log(`${version} ${name} ${hash}`);
}
