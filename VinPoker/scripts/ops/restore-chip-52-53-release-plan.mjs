import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalSqlText,scanMigrationSource} from './ops-1359-release-gate.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const specs=[
 ['20270128000052','floor_restore_receipt_reconciliation_v1','9629ee3543ef8eee2e5f97f61a9236cbdf383ace9fa39064d56e46ecc5d85de4',
  'public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','fcaca73302dcdab5810acb6b1e982211'],
 ['20270128000053','chip_color_up_receipt_reconciliation_v1','3284dafe204a92bc33b57221d08093106074796d374a44a29aeeba883a2a0270',
  'public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb)','03de175953ea06c3324431f05f4266eb'],
 ['20270128000054','restore_pending_cancellation_v1','db398f93e1d3f26ebca82f329ca8bbe6393cb3c6ba36bc2ab41912136f15312e',
  'public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','7aee1a55f770bd97b9f2ef0f9f666515'],
 ['20270128000055','chip_pending_cancellation_v1','c78099b9a34d5a7887f7d4b01901579ac39f3609c24836ba75ed4b7774cdc052',
  'public.cancel_chip_color_up_request_v1(uuid,text,text,jsonb)','51f1e89fd1fbaf0d59f5ff335a4ef6b3'],
];
export function loadPackage(){
 return specs.map(([version,name,hash,signature,bodyHash])=>{
  const filename=`${version}_${name}.sql`;
  const sql=canonicalSqlText(readFileSync(resolve(root,'supabase/migrations',filename),'utf8'));
  if(createHash('sha256').update(sql).digest('hex')!==hash||scanMigrationSource(sql).mode!=='outer-transaction')throw Error('Exact52/53 source drift');
  return {version,name,hash,signature,bodyHash,filename,sql,volatility:version<'20270128000054'?'s':'v'};
 });
}
export function dependencyPredicate(){
 return `(SELECT count(*)=9 AND bool_and(COALESCE(md5(replace(pg_get_functiondef(p.oid),chr(13),''))=e.hash
 AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY[e.path]::text[],false))
 FROM (VALUES
 ('floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)','1eb5c322975f7c8b1ab836c4e0a6b579','search_path=""'),
 ('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','908e103b6531f09540f4edb5d09e35ee','search_path=""'),
 ('floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','b36883a4b7e4249af756400c2849cffc','search_path=""'),
 ('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)','31191a2691e30698d1e3c0126b223421','search_path=""'),
 ('public.is_club_owner(uuid,uuid)','3ed99062028f203801b12552ae67769d','search_path=public'),
 ('public.is_club_chip_master(uuid,uuid)','f5d7be4b82778bbc5436e8e7d6137d31','search_path=public'),
 ('floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)','e61467bf5164ba3945676413764798ed','search_path=""'),
 ('public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text)','d15e5df6cfd4b2999cbaef5d0f2fe633','search_path=""'),
 ('public.chip_ops_reverse_color_up(uuid,text)','0fb0f9b56e039084d994d4045a68f9b2','search_path=""')) e(signature,hash,path)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature))
 AND EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('floor_private.chip_mutation_receipts') AND c.relrowsecurity
 AND pg_get_userbyid(c.relowner)='postgres'
 AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`;
}
export function atomicSql(item){
 const pinned=loadPackage().find(x=>x.version===item?.version);
 if(!pinned||Object.keys(pinned).some(k=>pinned[k]!==item[k]))throw Error('Exact52/53 allowlist mismatch');
 const scan=scanMigrationSource(item.sql),tag='$restore_chip_receipt$';
 if(item.sql.includes(tag))throw Error('Delimiter collision');
 const reader=item.version==='20270128000054'?loadPackage()[0]:item.version==='20270128000055'?loadPackage()[1]:null;
 const readerGuard=reader?` OR NOT COALESCE((SELECT md5(replace(pg_get_functiondef(p.oid),chr(13),''))='${reader.bodyHash}' AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[] FROM pg_proc p WHERE p.oid=to_regprocedure('${reader.signature}')),false)`:'';
 const guard=`SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SELECT pg_advisory_xact_lock(280000,3747);
 DO $restore_chip_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${item.version}' OR name='${item.name}')
 OR to_regprocedure('${item.signature}') IS NOT NULL OR NOT COALESCE((${dependencyPredicate()}),false)${readerGuard}
 THEN RAISE EXCEPTION 'restore_chip_precondition_drift';END IF;END $restore_chip_guard$;`;
 const receipt=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${item.version}','${item.name}',ARRAY[${tag}${item.sql}${tag}]::text[]);`;
 return item.sql.slice(0,scan.insertAfterBegin)+'\n'+guard+'\n'+item.sql.slice(scan.insertAfterBegin,scan.insertBeforeCommit)+receipt+'\n'+item.sql.slice(scan.insertBeforeCommit);
}
