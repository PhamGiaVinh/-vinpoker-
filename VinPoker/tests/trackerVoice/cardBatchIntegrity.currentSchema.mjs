import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_card56_20261011');
// Reuse existing Voice identities/session fixture, with real schema-required
// club names. No helper replacement, trigger disable, or role elevation.
const fixture=readFileSync('tests/trackerVoice/disposableDb.integration.sql','utf8');
assert.ok(fixture.indexOf('INSERT INTO public.tracker_voice_configs')>fixture.indexOf('INSERT INTO public.hand_players('),'fixture boundary must follow initial hand roster');
const prefix=fixture.slice(0,fixture.indexOf('INSERT INTO public.tracker_voice_configs'))
 .replace('public.clubs(id, owner_id)','public.clubs(id, owner_id, name, region)')
 .replace("('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001','Card integrity TEST','TEST')")
 .replace("('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001','Foreign card TEST','TEST')")
 .replace('public.club_trackers(club_id, user_id)','public.club_trackers(club_id, user_id, granted_by)')
 .replace("('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001')")
 .replace('public.tournaments(id, club_id, name, status)','public.tournaments(id, club_id, name, status, live_status)')
 .replace("'Voice V0 TEST', 'active')","'Voice V0 TEST', 'live', 'playing')")
 .replace("'Other Club TEST', 'active')","'Other Club TEST', 'live', 'playing')");
assert.equal(prefix.split('INSERT INTO public.tournament_hands(').length,2,'unique initial hand insert required');
const qualified=prefix.replace('INSERT INTO public.tournament_hands(',
 readFileSync('tests/trackerVoice/cardBatchIntegrity.roster.sql','utf8')+'\nINSERT INTO public.tournament_hands(');
const result=spawnSync('psql',['-X','-w','-v','ON_ERROR_STOP=1'],
 // Public-only capture omits managed auth schema grants. Read-only live
 // privilege checks verified these three roles have USAGE and uid/jwt EXECUTE.
 // Mirror only in this rollback transaction; no public table grants or bypass.
 {input:`BEGIN;\nGRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;\n${qualified}\n${readFileSync('tests/trackerVoice/cardBatchIntegrity.currentSchema.cases.sql','utf8')}\nROLLBACK;`,encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('CURRENT_SCHEMA_CARD_AUTHORITY_REVISION_COMPLETION_QUEUE_PASS');
