import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
assert.ok(['127.0.0.1','/var/run/postgresql'].includes(process.env.PGHOST));
const fullSchema=process.env.PGDATABASE==='vinpoker_ops_card56_overlap_20261011';
assert.ok(fullSchema||process.env.PGDATABASE==='vinpoker_card_batch_repro_20261011');
const hand=fullSchema?'86000000-0000-4000-8000-000000000001':'10000000-0000-4000-8000-000000000030';
const player=fullSchema?'82000000-0000-4000-8000-000000000001':'10000000-0000-4000-8000-000000000060';
const tracker='81400000-0000-4000-8000-000000000001';
const actor=fullSchema?`SET LOCAL request.jwt.claim.sub='${tracker}';SET LOCAL request.jwt.claims='{"sub":"${tracker}","role":"authenticated"}';SET LOCAL ROLE authenticated;`:'';
function sql(query) {
 const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
function tx(marker,query,hold=false) {
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);
  child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));
 });
 child.stdin.write(`SET application_name='${marker}';BEGIN;SET LOCAL statement_timeout='8s';${actor}${query}\n`);
 if(!hold) child.stdin.end('COMMIT;\n');
 return {result,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(marker,condition) {
 for(let i=0;i<100;i++) {
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${marker}' AND ${condition});`)==='t')return;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.fail(`overlap missing ${marker}`);
}
const holes=`SELECT public.show_hole_cards('${hand}','[{"player_id":"${player}","entry_number":1,"hole_cards":["Ah","As"]}]',auth.uid());`;
const board=`SELECT public.update_community_cards('${hand}','["Ah","Kh","Qs"]',auth.uid());`;
try {
 for(const holesFirst of [true,false]) {
  sql(`UPDATE hand_players SET hole_cards='[]' WHERE hand_id='${hand}';UPDATE tournament_hands SET community_cards='[]',locked_at=now()${fullSchema?`,locked_by_user_id='${tracker}'`:''} WHERE id='${hand}';`);
  const holder=tx('card_batch_holder',holesFirst?holes:board,true);
  await barrier('card_batch_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  const waiter=tx('card_batch_waiter',holesFirst?board:holes);
  await barrier('card_batch_waiter',"wait_event_type='Lock'");
  holder.commit();const first=await holder.result,second=await waiter.result;
  assert.equal(first.code,0,first.error);assert.match(first.out,/success/);
  assert.equal(second.code,0,second.error);assert.match(second.out,/card_already_used/);
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM tournament_hands h JOIN hand_players p ON p.hand_id=h.id WHERE h.id='${hand}' AND h.community_cards ? 'Ah' AND p.hole_cards ? 'Ah');`),'f');
 }
 console.log('CARD_BOARD_HOLE_BOTH_ORDER_TRUE_OVERLAP_PASS');
} finally {
 sql(`UPDATE hand_players SET hole_cards='[]' WHERE hand_id='${hand}';UPDATE tournament_hands SET community_cards='[]',locked_at=now() WHERE id='${hand}';`);
}
