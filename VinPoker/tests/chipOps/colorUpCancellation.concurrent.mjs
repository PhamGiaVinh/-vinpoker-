import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
// Existing isolated chip fixture, never a live pooler/database.
assert.match(process.env.PGHOST ?? '', /^(127\.0\.0\.1|\/tmp\/vinpoker-c4-pg17\.[A-Za-z0-9]+)$/);
assert.ok(['vinpoker_c4_chip53','vinpoker_chip_concurrency'].includes(process.env.PGDATABASE));
function sql(query) {
  const r = spawnSync('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function tx(name, query, hold) {
  const child = spawn('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='', error='';
  const result = new Promise((resolve, reject) => {
    child.stdout.on('data', c => out += c); child.stderr.on('data', c => error += c);
    child.on('error', reject); child.on('close', code => resolve({ code, out, error }));
  });
  child.stdin.write(`SET application_name='${name}'; BEGIN; SET LOCAL statement_timeout='10s';
    SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; ${query}\n`);
  if (!hold) child.stdin.end('COMMIT;\n');
  return { result, commit: () => child.stdin.end('COMMIT;\n') };
}
async function barrier(name, condition) {
  for (let i=0;i<120;i++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`) === 't') return;
    await new Promise(r => setTimeout(r,25));
  }
  assert.fail(`missing true overlap: ${name} ${condition}`);
}
const tour='00000000-0000-0000-0000-000000000002';
const op=sql("SELECT payload->>'operation' FROM floor_private.chip_mutation_receipts WHERE request_key='undo-first';");
assert.match(op,/^[0-9a-f-]{36}$/);
const before=sql('SELECT count(*) FROM public.chip_inventory_ledger;');
for (const cancelFirst of [true,false]) {
  const key=randomUUID(), tag=key.slice(0,8);
  const mutation=`SELECT public.chip_ops_reverse_color_up('${op}','${key}');`;
  const cancellation=`SELECT public.cancel_chip_color_up_request_v1('${tour}','reverse_color_up','${key}',jsonb_build_object('operation','${op}'::uuid));`;
  const first=tx(`cancel_first_${tag}`,cancelFirst?cancellation:mutation,true);
  let second;
  try {
    await barrier(`cancel_first_${tag}`,"state='idle in transaction'");
    second=tx(`cancel_second_${tag}`,cancelFirst?mutation:cancellation,false);
    await barrier(`cancel_second_${tag}`,"wait_event_type='Lock'");
  } finally { first.commit(); }
  const a=await first.result; assert.equal(a.code,0,a.error);
  assert.ok(second,'second transaction started');
  const b=await second.result; assert.equal(b.code,0,b.error);
  const parse=r=>JSON.parse(r.out.split('\n').find(line=>line.startsWith('{')));
  const winner=parse(a), waiter=parse(b);
  if(cancelFirst) {
    assert.equal(winner.result.status,'cancelled'); assert.deepEqual(waiter,winner.result);
  } else {
    assert.equal(winner.status,'ok'); assert.deepEqual(waiter.result,winner);
  }
  // Fresh connection readback after deliberately ignoring the first HTTP-equivalent response.
  const receipt=JSON.parse(sql(`SELECT result FROM floor_private.chip_mutation_receipts WHERE request_key='${key}';`));
  assert.deepEqual(receipt,cancelFirst?winner.result:winner);
  assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE request_key='${key}';`),'1');
}
assert.equal(sql('SELECT count(*) FROM public.chip_inventory_ledger;'),before);
for (const cancelFirst of [true,false]) {
  const freshTour=randomUUID(),key=randomUUID(),tag=key.slice(0,8);
  const low='00000000-0000-0000-0000-000000000004',high='00000000-0000-0000-0000-000000000005';
  const club='00000000-0000-0000-0000-000000000003';
  const template=randomUUID();
  sql(`INSERT INTO public.tournaments VALUES('${freshTour}','${club}',1,NULL);
    INSERT INTO public.tournament_chip_set VALUES('${freshTour}','${club}');
    INSERT INTO public.stack_template VALUES('${template}','${freshTour}','${club}');
    INSERT INTO public.stack_template_line VALUES('${template}','${low}',10);
    INSERT INTO public.stack_template_issuance VALUES('${template}',1,'${club}','00000000-0000-0000-0000-000000000001',now());`);
  const mutation=`SELECT public.chip_ops_color_up('${freshTour}','${low}','${high}',1,1,'${key}');`;
  const cancellation=`SELECT public.cancel_chip_color_up_request_v1('${freshTour}','color_up','${key}',
    jsonb_build_object('tournament','${freshTour}'::uuid,'removed','${low}'::uuid,'target','${high}'::uuid,'added',1,'level',1));`;
  const first=tx(`color_cancel_first_${tag}`,cancelFirst?cancellation:mutation,true);
  let second;
  try {
    await barrier(`color_cancel_first_${tag}`,"state='idle in transaction'");
    second=tx(`color_cancel_second_${tag}`,cancelFirst?mutation:cancellation,false);
    await barrier(`color_cancel_second_${tag}`,"wait_event_type='Lock'");
  } finally { first.commit(); }
  const a=await first.result; assert.equal(a.code,0,a.error);
  assert.ok(second); const b=await second.result; assert.equal(b.code,0,b.error);
  const parse=r=>JSON.parse(r.out.split('\n').find(line=>line.startsWith('{')));
  const winner=parse(a), waiter=parse(b);
  if(cancelFirst) { assert.equal(winner.result.status,'cancelled'); assert.deepEqual(waiter,winner.result); }
  else { assert.equal(winner.status,'ok',JSON.stringify(winner)); assert.equal(winner.removed_count,10); assert.deepEqual(waiter.result,winner); }
  assert.equal(sql(`SELECT count(*) FROM public.color_up_operation WHERE tournament_id='${freshTour}';`),cancelFirst?'0':'1');
  assert.equal(sql(`SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${freshTour}';`),cancelFirst?'0':'2');
  const late=JSON.parse(sql(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';${mutation}`));
  assert.deepEqual(late,cancelFirst?winner.result:winner);
}
console.log('CHIP55_TRUE_OVERLAP_CANCEL_VS_COLOR_UP_EFFECT_AND_REVERSE_RECEIPT_REPLAY_PASS');
