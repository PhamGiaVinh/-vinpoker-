import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(query) {
  const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const fixture=readFileSync('tests/dealerSwing/checkin.pg17.sql','utf8');
assert.equal((fixture.match(/ROLLBACK;/g)??[]).length,1);
sql(fixture.replace('ROLLBACK;','COMMIT;'));
sql(`UPDATE public.dealer_attendance SET status='checked_out',check_out_time=clock_timestamp()
  WHERE dealer_id='e1000000-0000-4000-8000-000000000005';
  CREATE FUNCTION public.checkin_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.dealer_id='e1000000-0000-4000-8000-000000000005' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$;
  CREATE TRIGGER checkin_test_delay BEFORE INSERT ON public.dealer_attendance FOR EACH ROW EXECUTE FUNCTION public.checkin_test_delay();`);
const query=`SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',false);
  SELECT public.operator_check_in_dealer_v1('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000020');`;
function call() {
  return new Promise((resolve,reject)=>{
    const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',err='';
    p.stdout.on('data',d=>out+=d); p.stderr.on('data',d=>err+=d);
    p.on('error',reject); p.on('close',code=>code===0?resolve(JSON.parse(out.trim().split('\n').at(-1))):reject(new Error(err)));
    p.stdin.end(query);
  });
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
const first=call();
let sleeping=false;
for(let i=0;i<30;i++) {
  if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%operator_check_in_dealer_v1%');")==='t') {sleeping=true;break;}
  await pause();
}
assert.ok(sleeping,'first session must be inside INSERT before second starts');
const second=call(); let blocked=false;
for(let i=0;i<30;i++) {
  if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='transactionid' AND query LIKE '%operator_check_in_dealer_v1%');")==='t') {blocked=true;break;}
  await pause();
}
assert.ok(blocked,'second session must actually overlap and wait on dealer row');
const [a,b]=await Promise.all([first,second]);
assert.equal(a.outcome,'checked_in'); assert.deepEqual(a,b,'same request returns the committed receipt');
assert.equal(sql("SELECT count(*) FROM public.dealer_attendance WHERE dealer_id='e1000000-0000-4000-8000-000000000005' AND status='checked_in';"),'1');
sql('DROP TRIGGER checkin_test_delay ON public.dealer_attendance; DROP FUNCTION public.checkin_test_delay();');
console.log('CHECKIN_TWO_SESSION_OVERLAP_AND_RESPONSE_LOSS_PASS');
