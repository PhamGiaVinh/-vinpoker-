import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(q){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function tx(name,q,hold,commit=false){
 const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>error+=c);p.on('close',code=>resolve({code,out,error}));p.on('error',e=>resolve({code:-1,error:String(e)}));});
 p.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';${q}\n`);
 if(!hold)p.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');
 return {result,finish:()=>p.stdin.end('ROLLBACK;\n')};
}
async function barrier(name,condition){for(let i=0;i<160;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('missing actual overlap barrier');}
for(const branding of [false,true]){
 const prefix=randomUUID().slice(0,8);
 let fixture=readFileSync('tests/floorProduction/trackerRosterSession.pg17.sql','utf8').split('-- Only public RPC calls')[0];
 const marker=" PERFORM set_config('role','authenticated',true);";
 assert.ok(fixture.includes(marker));
 fixture=fixture.replaceAll('f7280000',prefix).replace(marker,' RETURN;\n'+marker)+'\nCOMMIT;\n';
 sql(fixture);
 const tour=`${prefix}-0000-4000-8000-000000000003`,club=`${prefix}-0000-4000-8000-000000000002`;
 const token=`fixture-only-tv-concurrency-${randomUUID()}`;
 sql(`INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status) VALUES('${randomUUID()}','${club}','${token}','${tour}','paired');`);
 const call=`SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',${branding});`;
 const a=tx(`tv_a_${prefix}`,call,true);
 await barrier(`tv_a_${prefix}`,"state='idle in transaction'");
 const b=tx(`tv_b_${prefix}`,call,false);
 await barrier(`tv_b_${prefix}`,"wait_event_type='Lock'");a.finish();
 const results=await Promise.all([a.result,b.result]);
 for(const r of results){assert.equal(r.code,0,r.error);const payload=JSON.parse(r.out);assert.equal(payload.status,'paired');assert.equal(payload.tournament.id,tour);assert.ok(payload.participation_counts);}
 const reader=tx(`tv_read_${prefix}`,call,true);
 await barrier(`tv_read_${prefix}`,"state='idle in transaction'");
 const revoke=tx(`tv_revoke_${prefix}`,`UPDATE public.tv_displays SET status='revoked' WHERE display_token='${token}';`,false,true);
 await barrier(`tv_revoke_${prefix}`,"wait_event_type='Lock'");reader.finish();
 const [readResult,revokeResult]=await Promise.all([reader.result,revoke.result]);
 assert.equal(readResult.code,0,readResult.error);assert.equal(revokeResult.code,0,revokeResult.error);
 const revoked=JSON.parse(sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',${branding});ROLLBACK;`));
 assert.equal(revoked.status,'revoked');assert.equal(revoked.participation_counts,undefined);
}
console.log('PARTICIPATION_TV_TRUE_OVERLAP_PASS');
