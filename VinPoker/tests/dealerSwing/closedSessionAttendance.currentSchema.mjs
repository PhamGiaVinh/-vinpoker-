import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
const base=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
assert.equal(base.split('ROLLBACK;').length,2);
const anchor="SELECT set_config('request.jwt.claim.role','service_role',true);";
assert.equal(base.split(anchor).length,2);
for(const scenario of ['assigned','on_break','checked_out','pending_preassignment','malformed_assignment']){
 const setup=scenario==='checked_out'
  ? "UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now(),current_state='checked_out' WHERE id='e1700000-0000-4000-8000-000000000041';"
  : scenario==='pending_preassignment'
   ? "UPDATE public.dealer_attendance SET current_state='assigned',pre_assigned_table_id='e1700000-0000-4000-8000-000000000012',pre_assigned_at=now() WHERE id='e1700000-0000-4000-8000-000000000041';"
   : scenario==='malformed_assignment'
    ? "UPDATE public.dealer_assignments SET dealer_id='e1700000-0000-4000-8000-000000000039' WHERE table_session_id='e1700000-0000-4000-8000-000000000021';"
    : `UPDATE public.dealer_attendance SET current_state='${scenario}' WHERE id='e1700000-0000-4000-8000-000000000041';`;
 const expected=scenario==='assigned'?'available':scenario==='pending_preassignment'?'assigned':scenario;
 const closeAssertions=scenario==='malformed_assignment'?`
 DO $$ BEGIN
   BEGIN
     PERFORM public.operator_close_club_table_v2('e1700000-0000-4000-8000-000000000021',1,'e1700000-0000-4000-8000-000000000077');
     RAISE EXCEPTION 'malformed close unexpectedly accepted';
   EXCEPTION WHEN raise_exception THEN
     IF SQLERRM<>'closed_session_dealer_context_invalid' THEN RAISE; END IF;
   END;
 END $$;
 RESET ROLE;
 SELECT pg_temp.assert_true((SELECT closed_at IS NULL AND revision=1 FROM public.table_sessions WHERE id='e1700000-0000-4000-8000-000000000021'),'malformed close rolls back session');
 SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL),'malformed close rolls back assignment release');
 SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='e1700000-0000-4000-8000-000000000077'),'malformed close writes no success receipt');
 `:`
 SELECT pg_temp.assert_true((public.operator_close_club_table_v2('e1700000-0000-4000-8000-000000000021',1,gen_random_uuid())->>'ok')::boolean,'cash session actually closes');
 RESET ROLE;
 SELECT pg_temp.assert_true((SELECT current_state='${expected}' FROM public.dealer_attendance WHERE id='e1700000-0000-4000-8000-000000000041'),'cash closure attendance policy ${scenario}');
 SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL),'cash no active assignment');
 ${scenario==='pending_preassignment'?"SELECT pg_temp.assert_true((SELECT pre_assigned_table_id='e1700000-0000-4000-8000-000000000012' AND pre_assigned_at IS NOT NULL FROM public.dealer_attendance WHERE id='e1700000-0000-4000-8000-000000000041'),'pending preassignment preserved');":''}
 `;
 const end=`${setup}
 SELECT set_config('request.jwt.claim.sub','e1700000-0000-4000-8000-000000000001',true);
 SELECT set_config('request.jwt.claim.role','authenticated',true);
 SET LOCAL ROLE authenticated;
 ${closeAssertions}
 ROLLBACK;`;
 const query=base.replace(anchor,`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('e1700000-0000-4000-8000-000000000002',true) ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;\n${anchor}`).replace('ROLLBACK;',()=>end);
 const r=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 console.log(`CASH_CLOSED_SESSION_ATTENDANCE_POLICY_PASS scenario=${scenario}`);
}
