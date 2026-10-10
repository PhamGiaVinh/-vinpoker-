// Offline exact migration preparation. No network or execution path.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
import {loadPackage as loadPredecessors} from './floor-37-47-release-plan.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function loadMigration(sourceRoot=root){
 const version='20270128000048',name='floor_move_or_queue_exact_intent_v1';
 const hash='7ee0538bcd42c45ab746dba5dd8d9f91e2b01d655fa351930ee409f78f4488ae';
 const filename=`${version}_${name}.sql`;
 const sql=canonicalSqlText(readFileSync(resolve(sourceRoot,'supabase/migrations',filename),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==hash)throw Error('SQL drift 48');
 if(scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Transaction shape 48');
 return {version,name,hash,filename,sql};
}
export function predecessorPredicate(){
 return loadPredecessors().map(({version,name,hash})=>`EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}' AND name='${name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(replace(replace(statements[1],E'\\r\\n',E'\\n'),E'\\r',E'\\n'),'UTF8'),'sha256'),'hex')='${hash}')`).join(' AND ');
}
export function atomicSql(item=loadMigration()){
 const canonical=loadMigration();
 if(item.version!==canonical.version||item.name!==canonical.name||item.hash!==canonical.hash||item.sql!==canonical.sql)throw Error('Not exact migration48 allowlist');
 const tag='$floor_48_receipt$',scan=scanMigrationSource(item.sql);
 if(item.sql.includes(tag))throw Error('Receipt delimiter collision');
 const guard=`SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\nSELECT pg_advisory_xact_lock(280000,3747);\nDO $floor_48_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}') THEN RAISE EXCEPTION 'floor48_receipt_exists_stop'; END IF;
 IF NOT (${predecessorPredicate()}) THEN RAISE EXCEPTION 'floor48_predecessor_drift'; END IF;
 END $floor_48_guard$;\n`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);\n`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+item.sql.slice(scan.insertBeforeCommit);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('Offline plan only');
 const {version,name,hash}=loadMigration();console.log(`${version} ${name} ${hash}`);
}
