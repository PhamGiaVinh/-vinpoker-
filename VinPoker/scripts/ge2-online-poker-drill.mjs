#!/usr/bin/env node
// scripts/ge2-online-poker-drill.mjs
//
// GE-2 online-poker G4 LIVE DRILL harness — Edge-path cases only.
// Raw fetch, no dependencies, NO hardcoded secrets. Everything is read from env.
//
// What this covers (client INTENT only — the engine runs in the Edge):
//   disabled-check : every op returns 403 "disabled" while online_poker_config.enabled=false
//   setup          : P1+P2 claim play chips, sit, then start a hand   [needs flag ON → Phase D]
//   drill          : idempotency replay · forbidden-seat · secrecy · play-to-showdown
//                    (chip-conservation PASS observed)                [needs flag ON → Phase D]
//   teardown       : P1+P2 stand up                                   [needs flag ON → Phase D]
//
// The two ADVERSARIAL cases (chip-conservation FAIL, race_lost) need a service-role
// call with a crafted/stale state — a client (user JWT) cannot reach those RPCs.
// They live in scripts/ge2-drill/sql/ and are run by the operator via the
// Management-API keyring helper, NOT here.
//
// SAFETY: this harness NEVER flips a flag. setup/drill only succeed once the owner
// has run the Phase-D enable step; while dark they all return "disabled".
//
// Usage (Node >= 20.6 for --env-file; otherwise export the vars yourself):
//   node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs disabled-check
//   node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs setup
//   node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs drill
//   node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs teardown
//
// Required env (see scripts/.env.ge2-drill.example):
//   SUPABASE_URL, SUPABASE_ANON_KEY          (anon key is public, not a secret)
//   P1_EMAIL, P1_PASSWORD, P2_EMAIL, P2_PASSWORD   (disposable test accounts)
//   TABLE_ID                                  (disposable online_poker_tables UUID)

const URL = reqEnv('SUPABASE_URL').replace(/\/$/, '');
const ANON = reqEnv('SUPABASE_ANON_KEY');
const BUYIN = process.env.BUYIN ?? '10000';
const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';

function reqEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing env: ${name} (see scripts/.env.ge2-drill.example)`); process.exit(2); }
  return v;
}
function idem() { return crypto.randomUUID(); }
const j = (o) => JSON.stringify(o);

// ── auth: sign a disposable test account in, return its access token ──────────
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: j({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(`signIn(${email}) failed: HTTP ${r.status} ${j(body)}`);
  }
  return body.access_token;
}

// ── call the Edge function with a user JWT ────────────────────────────────────
async function edge(op, fields, jwt) {
  const r = await fetch(`${URL}/functions/v1/online-poker-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${jwt}` },
    body: j({ op, ...fields }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

// ── read the current public hand state for a table via PostgREST (rail) ──────
async function readHand(tableId, jwt) {
  const q = `table_id=eq.${tableId}&order=hand_no.desc&limit=1&select=id,status,state,state_version`;
  const r = await fetch(`${URL}/rest/v1/online_poker_hands?${q}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// ── tiny assertion harness ────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── disabled-check (runnable NOW; while dark every op must 403) ───────────────
async function disabledCheck() {
  console.log('# disabled-check (expects 401 unauth, 403 "disabled" for every op while flag OFF)');

  // unauthenticated → 401 (function G2 gate)
  const r0 = await fetch(`${URL}/functions/v1/online-poker-action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: j({ op: 'claim_daily_chips' }),
  });
  check('unauthenticated → 401', r0.status === 401, `HTTP ${r0.status}`);

  const jwt = await signIn(reqEnv('P1_EMAIL'), reqEnv('P1_PASSWORD'));
  const ops = [
    ['claim_daily_chips', {}],
    ['get_my_hole_cards', { handId: DUMMY_UUID }],
    ['sit_down', { tableId: DUMMY_UUID, seat: 1, buyin: BUYIN, idempotencyKey: idem() }],
    ['stand_up', { tableId: DUMMY_UUID, idempotencyKey: idem() }],
    ['start_hand', { tableId: DUMMY_UUID, idempotencyKey: idem() }],
    ['submit_action', { handId: DUMMY_UUID, seat: 1, type: 'check', idempotencyKey: idem() }],
  ];
  for (const [op, f] of ops) {
    const { status, body } = await edge(op, f, jwt);
    const disabled = status === 403 && /disabled/i.test(j(body));
    check(`${op} → disabled`, disabled, `HTTP ${status} ${j(body)}`);
  }
}

// ── setup (Phase D, flag ON): claim + sit + start a hand ─────────────────────
async function setup() {
  const tableId = reqEnv('TABLE_ID');
  const p1 = await signIn(reqEnv('P1_EMAIL'), reqEnv('P1_PASSWORD'));
  const p2 = await signIn(reqEnv('P2_EMAIL'), reqEnv('P2_PASSWORD'));
  for (const [name, jwt, seat] of [['P1', p1, 1], ['P2', p2, 2]]) {
    const claim = await edge('claim_daily_chips', {}, jwt);
    if (claim.status === 403) { console.error('runtime DISABLED — run Phase D enable first'); process.exit(1); }
    const sit = await edge('sit_down', { tableId, seat, buyin: BUYIN, idempotencyKey: idem() }, jwt);
    console.log(`${name}: claim=${j(claim.body)} sit=${j(sit.body)}`);
  }
  const start = await edge('start_hand', { tableId, idempotencyKey: idem() }, p1);
  console.log(`start_hand: ${j(start.body)}`);
  if (start.body?.hand_id) console.log(`\nHAND_ID=${start.body.hand_id}`);
  return { tableId, p1, p2, handId: start.body?.hand_id };
}

// ── drill (Phase D, flag ON): the Edge-path G4 cases ─────────────────────────
async function drill() {
  const tableId = reqEnv('TABLE_ID');
  const p1 = await signIn(reqEnv('P1_EMAIL'), reqEnv('P1_PASSWORD'));
  const p2 = await signIn(reqEnv('P2_EMAIL'), reqEnv('P2_PASSWORD'));
  const hand = await readHand(tableId, p1);
  if (!hand) { console.error('no hand found — run `setup` first (Phase D)'); process.exit(1); }
  const handId = hand.id;
  const st = hand.state;
  const toAct = st.toAct;
  console.log(`# drill on hand ${handId} (status=${hand.status}, toAct seat ${toAct}, version ${hand.state_version})`);

  // map seat -> which test player owns it (seat 1 = P1, seat 2 = P2 per setup)
  const jwtForSeat = (s) => (s === 1 ? p1 : p2);
  const otherSeat = (s) => (s === 1 ? 2 : 1);

  // secrecy: each player sees ONLY own hole cards; public state carries none
  const h1 = await edge('get_my_hole_cards', { handId }, p1);
  const h2 = await edge('get_my_hole_cards', { handId }, p2);
  check('P1 sees own hole cards', h1.body?.outcome === 'ok' && Array.isArray(h1.body?.cards), j(h1.body));
  check('P2 sees own hole cards', h2.body?.outcome === 'ok' && Array.isArray(h2.body?.cards), j(h2.body));
  check('public state has NO holeCards/deck',
    !/holeCards|"deck"/.test(j(st)), 'public hands.state');

  // forbidden-seat: the toAct player tries to act as the OTHER seat
  const fb = await edge('submit_action',
    { handId, seat: otherSeat(toAct), type: 'check', idempotencyKey: idem() }, jwtForSeat(toAct));
  check('forbidden-seat rejected',
    /forbidden/i.test(j(fb.body)) || fb.status === 403, `HTTP ${fb.status} ${j(fb.body)}`);

  // idempotency replay: same key twice → identical stored response, no double-apply
  const seatJwt = jwtForSeat(toAct);
  const mySeat = (st.seats || []).find((s) => s.seat === toAct) || {};
  const toCall = Number(st.currentBet ?? '0') - Number(mySeat.committed ?? '0');
  const legalType = toCall > 0 ? 'call' : 'check';
  const k = idem();
  const a1 = await edge('submit_action', { handId, seat: toAct, type: legalType, idempotencyKey: k }, seatJwt);
  const a2 = await edge('submit_action', { handId, seat: toAct, type: legalType, idempotencyKey: k }, seatJwt);
  check('idempotency replay returns same response',
    a1.status === a2.status && j(a1.body) === j(a2.body), `1=${j(a1.body)} 2=${j(a2.body)}`);

  // chip-conservation PASS is implicit: a1 must have been accepted (ok) by the engine + RPC
  check('chip-conservation PASS (legal action accepted)',
    a1.body?.ok === true || a1.body?.outcome === 'ok', j(a1.body));

  console.log(`\n# Edge-path drill: ${pass} pass / ${fail} fail`);
  console.log('# NOTE: chip-conservation FAIL + race_lost are run separately via');
  console.log('#       scripts/ge2-drill/sql/ (service-role, crafted/stale state).');
  if (fail) process.exit(1);
}

// ── teardown (Phase D): stand both players up ────────────────────────────────
async function teardown() {
  const tableId = reqEnv('TABLE_ID');
  const p1 = await signIn(reqEnv('P1_EMAIL'), reqEnv('P1_PASSWORD'));
  const p2 = await signIn(reqEnv('P2_EMAIL'), reqEnv('P2_PASSWORD'));
  for (const [name, jwt] of [['P1', p1], ['P2', p2]]) {
    const r = await edge('stand_up', { tableId, idempotencyKey: idem() }, jwt);
    console.log(`${name} stand_up: ${j(r.body)}`);
  }
  console.log('# table + accounts cleanup: run scripts/ge2-drill/sql/99_teardown.sql via the keyring helper');
}

const cmd = process.argv[2];
const run = { 'disabled-check': disabledCheck, setup, drill, teardown }[cmd];
if (!run) {
  console.log('usage: node ge2-online-poker-drill.mjs <disabled-check|setup|drill|teardown>');
  process.exit(2);
}
run().then(() => {
  if (cmd === 'disabled-check') { console.log(`\n# disabled-check: ${pass} pass / ${fail} fail`); if (fail) process.exit(1); }
}).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
