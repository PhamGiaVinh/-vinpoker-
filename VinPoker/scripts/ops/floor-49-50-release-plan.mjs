// Offline exact package preparation; no connection or execution path.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {loadMigration as load48,predecessorPredicate as predecessors37to47} from './floor-48-release-plan.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const pins=[
 ['20270128000049','floor_mode_tombstone_guard_v1','eabbd6af0738a10d3a492b5e26c173b7e3c4fa3fc0c819ff4df2d06d433586a7'],
 ['20270128000050','floor_mode_retry_schedule_v1','a173187282c167238d204c48d50b23895459f4698afcdfe498bca4ee64d76c2a'],
];
export function loadPackage(sourceRoot=root){
 return pins.map(([version,name,hash])=>{
  const filename=`${version}_${name}.sql`;
  const sql=canonicalSqlText(readFileSync(resolve(sourceRoot,'supabase/migrations',filename),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash)throw Error(`SQL drift ${version}`);
  if(scanMigrationSource(sql).mode!=='outer-transaction')throw Error(`Transaction shape ${version}`);
  return {version,name,hash,filename,sql};
 });
}
function exactReceipt(item){
 return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' AND name='${item.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${item.hash}')`;
}
export function predecessorPredicate(item=loadPackage()[0]){
 const items=loadPackage(),index=items.findIndex(x=>x.version===item.version);
 if(index<0)throw Error('Not exact49/50 version');
 return [predecessors37to47(),exactReceipt(load48()),...items.slice(0,index).map(exactReceipt)].join(' AND ');
}
export function atomicSql(item){
 const canonical=loadPackage().find(x=>x.version===item?.version);
 if(!canonical||['version','name','hash','filename','sql'].some(k=>item[k]!==canonical[k]))throw Error('Not exact49/50 allowlist');
 const scan=scanMigrationSource(item.sql),tag='$floor_49_50_receipt$';
 if(item.sql.includes(tag))throw Error('Receipt delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\nSELECT pg_advisory_xact_lock(280000,3747);\nDO $floor_49_50_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}') THEN RAISE EXCEPTION 'floor49_50_receipt_exists_stop'; END IF;
 IF NOT (${predecessorPredicate(item)}) THEN RAISE EXCEPTION 'floor49_50_predecessor_drift'; END IF;
 END $floor_49_50_guard$;\n`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);\n`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+item.sql.slice(scan.insertBeforeCommit);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('Offline plan only');
 for(const {version,name,hash} of loadPackage())console.log(`${version} ${name} ${hash}`);
}
