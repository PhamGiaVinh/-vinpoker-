import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Isolated schema runtime only; terminal UPDATE tests the consumer, not record_hand.
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(query) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {input: query, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function tx(name, query, hold = false) {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']);
  let out = '', error = '';
  const result = new Promise(resolve => {
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => error += c);
    child.on('close', code => resolve({code, out, error}));
    child.on('error', e => resolve({code: -1, out, error: String(e)}));
  });
  child.stdin.write(`SET application_name='${name}'; BEGIN; SET LOCAL statement_timeout='8s'; ${query}\n`);
  if (!hold) child.stdin.end('COMMIT;\n');
  return {result, commit: () => child.stdin.end('COMMIT;\n')};
}
async function barrier(name, condition) {
  for (let i = 0; i < 160; i++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`) === 't') return;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.fail(`overlap barrier absent: ${name}`);
}
function fixture() {
  const actor = randomUUID(), club = randomUUID(), tour = randomUUID(), physical = randomUUID();
  sql(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${club}','${actor}','Mode overlap TEST','TEST');
    INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES('${tour}','${club}','Mode overlap TEST','live','playing',1);
    INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES('${tour}',1,100,200,0,false);
    INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES('${physical}','${club}','Mode TEST',81,'tournament','inactive','available');
    SELECT set_config('request.jwt.claim.sub','${actor}',true);
    SELECT public.floor_open_tournament_table_v3('${tour}','${physical}','manual',gen_random_uuid()); COMMIT;`);
  const table = sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${tour}';`);
  const session = sql(`SELECT table_session_id FROM public.tournament_tables WHERE id='${table}';`);
  assert.match(table, /^[0-9a-f-]{36}$/);
  assert.match(session, /^[0-9a-f-]{36}$/);
  return {actor, club, tour, physical, table, session};
}
function request(f, target, key, revision, epoch) {
  return `SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
    SELECT public.floor_request_table_control_mode_v4('${f.table}','${f.session}','${target}',${revision},${epoch},'${key}');`;
}
async function overlap(firstQuery, secondQuery) {
  const tag = randomUUID().slice(0, 8), first = tx(`mode_first_${tag}`, firstQuery, true);
  let second;
  try {
    await barrier(`mode_first_${tag}`, "state='idle in transaction'");
    second = tx(`mode_second_${tag}`, secondQuery);
    await barrier(`mode_second_${tag}`, "wait_event_type='Lock'");
  } finally { first.commit(); }
  const a = await first.result;
  assert.equal(a.code, 0, a.error);
  const b = await second.result;
  assert.equal(b.code, 0, b.error);
  return [a, b];
}
for (const sameKey of [true, false]) {
  const f = fixture(), key = randomUUID();
  const [revision, epoch] = sql(`SELECT revision||','||control_epoch FROM public.table_sessions WHERE id='${f.session}';`).split(',');
  const [a, b] = await overlap(request(f, 'tracker', key, revision, epoch), request(f, 'tracker', sameKey ? key : randomUUID(), revision, epoch));
  assert.match(a.out, /"outcome": "applied"/);
  assert.match(b.out, sameKey ? /"outcome": "applied"/ : /STALE_STATE/);
  assert.equal(sql(`SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}';`), '1');
  assert.equal(sql(`SELECT control_mode||','||(control_epoch=${epoch}+1)::text FROM public.table_sessions WHERE id='${f.session}';`), 'tracker,true');
  assert.match(sql(`BEGIN; ${request(f, 'manual', key, revision, epoch)} COMMIT;`), /IDEMPOTENCY_CONFLICT/);
  const foreign = fixture();
  assert.match(sql(`BEGIN; ${request({...f, actor: foreign.actor}, 'manual', randomUUID(), revision, epoch)} COMMIT;`), /actor_not_allowed/);
  assert.match(sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${foreign.actor}',true);
    SELECT public.floor_get_table_control_mode_request_v1('${f.table}','${f.session}'); COMMIT;`), /actor_not_allowed/);
  assert.equal(sql(`SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}';`), '1');
  assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${foreign.actor}' AND operation_type='floor_request_table_control_mode_v4';`), '0');
}
assert.equal(sql(`SELECT has_function_privilege('anon','public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','EXECUTE');`), 'f');
for (const cancelFirst of [true, false]) {
  const f = fixture(), config = randomUUID();
  sql(`INSERT INTO public.tracker_voice_configs(id,club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,correction_state)
    VALUES('${config}','${f.club}','${f.tour}','${f.table}','${f.physical}','${f.session}','correction_pending');`);
  const [revision, epoch] = sql(`SELECT revision||','||control_epoch FROM public.table_sessions WHERE id='${f.session}';`).split(',');
  const queued = sql(`BEGIN; ${request(f, 'tracker', randomUUID(), revision, epoch)} COMMIT;`);
  assert.match(queued, /"outcome": "pending"/);
  assert.match(queued, /correction_pending/);
  const pending = sql(`SELECT id FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}' AND status='pending';`);
  const cancel = `SELECT set_config('request.jwt.claim.sub','${f.actor}',true); SELECT public.floor_cancel_table_control_mode_request_v1('${f.table}','${f.session}','${pending}');`;
  // Isolated blocker-resolution consumer, not proof of the correction RPC itself.
  const clear = `UPDATE public.tracker_voice_configs SET correction_state='ready' WHERE id='${config}'; SET CONSTRAINTS ALL IMMEDIATE;`;
  const [a, b] = await overlap(cancelFirst ? cancel : clear, cancelFirst ? clear : cancel);
  assert.match((cancelFirst ? a : b).out, cancelFirst ? /"outcome": "cancelled"/ : /request_not_pending/);
  assert.equal(sql(`SELECT status FROM floor_private.table_mode_requests_v1 WHERE id='${pending}';`), cancelFirst ? 'cancelled' : 'applied');
  assert.equal(sql(`SELECT control_mode FROM public.table_sessions WHERE id='${f.session}';`), cancelFirst ? 'manual' : 'tracker');
}
for (const canonical of [false, true]) for (const cancelFirst of [true, false]) {
  const f = fixture();
  let hand = randomUUID();
  if (canonical) {
    const seeded = sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
      SELECT public.set_tracker_table_roster_seat_v2('${f.tour}','${f.table}','${f.session}',s.control_epoch,gen_random_uuid(),1,'Mode TEST 1',20000) FROM public.table_sessions s WHERE s.id='${f.session}';
      SELECT public.set_tracker_table_roster_seat_v2('${f.tour}','${f.table}','${f.session}',s.control_epoch,gen_random_uuid(),2,'Mode TEST 2',20000) FROM public.table_sessions s WHERE s.id='${f.session}';
      UPDATE public.table_sessions SET control_mode='tracker' WHERE id='${f.session}';
      SELECT public.start_tracker_hand_v3('${f.tour}','${f.table}','${f.session}',s.control_epoch,1,now(),'${f.actor}',1) FROM public.table_sessions s WHERE s.id='${f.session}'; COMMIT;`);
    assert.equal((seeded.match(/"ok": true/g) || []).length, 2, seeded);
    assert.match(seeded, /"status": "success"/);
    hand = sql(`SELECT id FROM public.tournament_hands WHERE table_session_id='${f.session}' AND status='in_progress';`);
    assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE table_session_id='${f.session}' AND is_active AND entry_id IS NOT NULL;`), '2');
  } else sql(`INSERT INTO public.tournament_seats(tournament_id,table_id,tournament_table_id,table_session_id,seat_number,chip_count,player_name)
    VALUES('${f.tour}','${f.table}','${f.table}','${f.session}',1,20000,'Consumer fixture TEST 1'),('${f.tour}','${f.table}','${f.table}','${f.session}',2,20000,'Consumer fixture TEST 2');
    UPDATE public.table_sessions SET control_mode='tracker' WHERE id='${f.session}';
    INSERT INTO public.tournament_hands(id,tournament_id,table_id,tournament_table_id,table_session_id,status,hand_number) VALUES('${hand}','${f.tour}','${f.table}','${f.table}','${f.session}','in_progress',1);`);
  const [revision, epoch] = sql(`SELECT revision||','||control_epoch FROM public.table_sessions WHERE id='${f.session}';`).split(',');
  const token = canonical ? sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.actor}',true); SELECT public.get_tracker_roster_snapshot_v1('${f.tour}','${f.table}','${f.session}',${epoch})->'seats'->0->>'token'; COMMIT;`).split('\n').at(-1) : null;
  assert.match(sql(`BEGIN; ${request(f, 'manual', randomUUID(), revision, epoch)} COMMIT;`), /"outcome": "pending"/);
  const pending = sql(`SELECT id FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}' AND status='pending';`);
  const cancel = `SELECT set_config('request.jwt.claim.sub','${f.actor}',true); SELECT public.floor_cancel_table_control_mode_request_v1('${f.table}','${f.session}','${pending}');`;
  const finish = canonical ? `SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
    SELECT public.record_hand('${f.tour}','${f.table}',1,now(),
      (SELECT jsonb_agg(jsonb_build_object('player_id',hp.player_id,'entry_number',hp.entry_number,'seat_number',hp.seat_number,'starting_stack',hp.starting_stack,'ending_stack',hp.starting_stack+CASE hp.seat_number WHEN 1 THEN 100 ELSE -100 END,'is_eliminated',false)) FROM public.hand_players hp WHERE hp.hand_id='${hand}'),
      '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'${f.actor}'); SET CONSTRAINTS ALL IMMEDIATE;`
    : `UPDATE public.tournament_hands SET status='completed' WHERE id='${hand}'; SET CONSTRAINTS ALL IMMEDIATE;`;
  const [a, b] = await overlap(cancelFirst ? cancel : finish, cancelFirst ? finish : cancel);
  if (canonical) assert.match((cancelFirst ? b : a).out, /"ok": true/);
  assert.match((cancelFirst ? a : b).out, cancelFirst ? /"outcome": "cancelled"/ : /request_not_pending/);
  assert.equal(sql(`SELECT status FROM floor_private.table_mode_requests_v1 WHERE id='${pending}';`), cancelFirst ? 'cancelled' : 'applied');
  assert.equal(sql(`SELECT control_mode FROM public.table_sessions WHERE id='${f.session}';`), cancelFirst ? 'tracker' : 'manual');
  assert.equal(sql(`SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}' AND status='pending';`), '0');
  assert.equal(sql(`SELECT count(*)||','||sum(chip_count) FROM public.tournament_seats WHERE table_session_id='${f.session}' AND is_active;`), '2,40000');
  if (canonical) {
    assert.equal(sql(`SELECT string_agg(chip_count::text,',' ORDER BY seat_number) FROM public.tournament_seats WHERE table_session_id='${f.session}' AND is_active;`), '20100,19900');
    assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${hand}' AND status='completed';`), '1');
    assert.equal(sql(`SELECT string_agg(e.current_stack::text,',' ORDER BY s.seat_number) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id WHERE s.table_session_id='${f.session}' AND s.is_active;`), '20100,19900');
    const delayed = sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
      SELECT public.set_tracker_table_roster_seat_v2('${f.tour}','${f.table}','${f.session}',${epoch},gen_random_uuid(),1,'Mode TEST 1',20000,
        (SELECT player_id FROM public.tournament_seats WHERE table_session_id='${f.session}' AND is_active AND seat_number=1),false,NULL,'${token}'); COMMIT;`);
    assert.match(delayed, cancelFirst ? /STALE_ROSTER_STATE/ : /STALE_STATE/);
    assert.equal(sql(`SELECT chip_count FROM public.tournament_seats WHERE table_session_id='${f.session}' AND is_active AND seat_number=1;`), '20100');
  }
}
{
  const f = fixture();
  sql(`INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,correction_state)
    VALUES('${f.club}','${f.tour}','${f.table}','${f.physical}','${f.session}','correction_pending');`);
  const [revision, epoch] = sql(`SELECT revision||','||control_epoch FROM public.table_sessions WHERE id='${f.session}';`).split(',');
  assert.match(sql(`BEGIN; ${request(f, 'tracker', randomUUID(), revision, epoch)} COMMIT;`), /"outcome": "pending"/);
  const closed = sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
    SELECT public.close_tournament_table_v4('${f.table}',${revision},gen_random_uuid()); COMMIT;`);
  assert.match(closed, /"ok": true/);
  assert.equal(sql(`SELECT status FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${f.session}';`), 'expired');
  assert.match(sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${f.actor}',true);
    SELECT public.floor_open_tournament_table_v3('${f.tour}','${f.physical}','manual',gen_random_uuid()); COMMIT;`), /"ok": true/);
  const reopened = sql(`SELECT table_session_id FROM public.tournament_tables WHERE tournament_id='${f.tour}' AND status='active';`);
  assert.notEqual(reopened, f.session);
  assert.equal(sql(`SELECT control_mode FROM public.table_sessions WHERE id='${reopened}';`), 'manual');
  assert.equal(sql(`SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='${reopened}';`), '0');
  assert.match(sql(`BEGIN; ${request(f, 'tracker', randomUUID(), revision, epoch)} COMMIT;`), /table_session_mismatch/);
}
console.log('TABLE_MODE_REQUEST_TRUE_OVERLAP_PASS (receipt/tenant/stale; cancel versus correction/terminal/canonical finish; close/reopen request expiry)');
