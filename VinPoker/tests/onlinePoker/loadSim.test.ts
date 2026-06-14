// tests/onlinePoker/loadSim.test.ts
// IN-PROCESS load/soak simulator for the pure NLH engine, sized to the GE-2 capacity
// target (9-handed tables; 1 → 3 → 10 → 30 concurrent tables). It proves the
// engine-level invariants hold at scale and that tables are independent (one table
// failing cannot abort the others). It runs ENTIRELY in-process (no DB, no Edge, no
// network, no flag) — the safe "dry/simulated mode" of the load harness. The LIVE
// 1/3/10/30-table throughput run (real Edge + many bot logins) is a Phase-D exercise
// (see scripts/ge2-drill/README.md) and is NOT run here.
//
// Per-table behaviours exercised: random legal actions, all-in / side pots, showdown,
// fold-to-winner, hand completion, chip conservation after every action, no negative
// stack/pot, public-state secrecy (no holeCards/deck on the wire). Plus standalone:
// out-of-turn rejection and engine purity (the engine half of idempotency-replay).
//
// NOT covered here (runtime layer, owner-gated Phase D): RPC idempotency_key replay,
// JWT/forbidden-seat auth, realtime reconnect/fetch. Those need the live runtime.

import { describe, it, expect } from 'vitest';
import {
  createHand, legalActions, applyAction, assertInvariants, toWirePublicState,
  makeDeck, shuffle,
} from '@engine/index.ts';
import type { Action, HandState } from '@engine/index.ts';
import { mulberry32, si, totalChips } from '../pokerEngine/fixtures.ts';

const SB = 50n, BB = 100n;
const SEATS = 9;
const HANDS_PER_TABLE = 4;
const PHASES = [1, 3, 10, 30] as const; // tables × 9 seats

type Rng = () => number;

/** Heterogeneous short stacks (1..15 BB) so all-ins and layered side pots actually occur. */
function randStacks(rng: Rng, n: number): bigint[] {
  return Array.from({ length: n }, () => BB * BigInt(1 + (rng() % 15)));
}

function deal(stacks: bigint[], seed: number, button: number): HandState {
  const deck = shuffle(makeDeck(), mulberry32(seed));
  return createHand(
    { handId: `L${seed}`, tableId: `t${seed % 31}`, handNo: 1, buttonSeat: button, sb: SB, bb: BB },
    deck,
    si(stacks),
  ).state;
}

function pickAction(state: HandState, rng: Rng): Action | null {
  const seat = state.toAct;
  if (seat == null) return null;
  const la = legalActions(state, seat);
  if (la.types.length === 0) return null;
  if (la.types.includes('allin') && rng() % 4 === 0) return { type: 'allin', seat }; // bias → side pots
  const t = la.types[rng() % la.types.length];
  if (t === 'bet' || t === 'raise') {
    const span = la.maxRaiseTo - la.minRaiseTo;
    const amount = span <= 0n ? la.minRaiseTo : la.minRaiseTo + (BigInt(rng()) % (span + 1n));
    return { type: t, seat, amount };
  }
  return { type: t, seat };
}

/** The persisted public wire must never carry hidden hole cards or the deck. */
function assertNoLeak(state: HandState): void {
  const json = JSON.stringify(toWirePublicState(state));
  if (json.includes('holeCards')) throw new Error('LEAK: holeCards on public wire');
  if (json.includes('"deck"')) throw new Error('LEAK: deck on public wire');
}

interface HandStat { actions: number; allIn: boolean; sidePotLayers: number }

/** Play one full 9-handed hand with a random legal line; throws on any invariant breach. */
function simulateHand(seed: number): HandStat {
  const stacks = randStacks(mulberry32(seed ^ 0x9e3779b9), SEATS);
  let st = deal(stacks, seed, 1 + (seed % SEATS));
  const total = totalChips(st);
  assertInvariants(st, total);
  assertNoLeak(st);

  const rng = mulberry32(seed ^ 0x1234abcd);
  let actions = 0, attempts = 0, allIn = false;
  while (st.status === 'betting' && st.toAct != null) {
    if (++attempts > 3000) throw new Error('stuck hand (attempt cap)');
    const a = pickAction(st, rng);
    if (!a) break;
    const r = applyAction(st, a);
    if (r.error) continue; // illegal edge pick; state unchanged, re-pick
    st = r.state; actions++;
    if (a.type === 'allin') allIn = true;
    if (totalChips(st) !== total) throw new Error('chip conservation broken mid-hand');
    if (!st.seats.every((s) => s.stack >= 0n)) throw new Error('negative stack');
    if (st.pot < 0n) throw new Error('negative pot');
    if (actions > 1000) throw new Error('stuck hand (action cap)');
  }
  if (st.status !== 'complete') throw new Error(`hand did not complete (status=${st.status})`);
  if (totalChips(st) !== total) throw new Error('chip conservation broken at completion');
  assertInvariants(st, total);
  assertNoLeak(st);
  return { actions, allIn, sidePotLayers: st.result?.potAwards.length ?? 0 };
}

describe('online-poker load simulation (in-process engine; no DB/Edge/flag)', () => {
  for (const tables of PHASES) {
    it(`${tables} table(s) × ${SEATS} seats × ${HANDS_PER_TABLE} hands — isolated, conserved, no leak, no stuck`, () => {
      const results: Array<{ table: number; ok: boolean; hands: number; error?: string }> = [];
      let totalActions = 0, sidePotHands = 0, allInHands = 0;

      for (let t = 0; t < tables; t++) {
        try {
          let hands = 0;
          for (let h = 0; h < HANDS_PER_TABLE; h++) {
            const r = simulateHand(((tables * 1000 + t) * 97 + h) ^ 0x55aa55aa);
            hands++; totalActions += r.actions;
            if (r.sidePotLayers >= 2) sidePotHands++;
            if (r.allIn) allInHands++;
          }
          results.push({ table: t, ok: true, hands });
        } catch (e) {
          // ISOLATION: record this table's failure but DO NOT abort the others.
          results.push({ table: t, ok: false, hands: 0, error: e instanceof Error ? e.message : String(e) });
        }
      }

      const failed = results.filter((r) => !r.ok);
      // eslint-disable-next-line no-console
      console.log(`[loadSim] ${tables} tables: ${results.length} ran, ${failed.length} failed, ${totalActions} actions, side-pots in ${sidePotHands} hands, all-ins in ${allInHands} hands`);

      expect(results.length).toBe(tables);                 // every table ran independently
      expect(failed).toEqual([]);                          // 0 conservation/negative/stuck/leak
      expect(results.every((r) => r.hands === HANDS_PER_TABLE)).toBe(true);
      if (tables >= 10) expect(allInHands).toBeGreaterThan(0);   // the stress path was exercised
    });
  }

  it('table isolation: a thrown simulation does not contaminate sibling tables', () => {
    // Run a batch where one "table" is forced to throw; the rest must still pass.
    const run = (t: number) => { if (t === 1) throw new Error('injected table fault'); return simulateHand(900 + t); };
    const out = Array.from({ length: 4 }, (_, t) => { try { run(t); return true; } catch { return false; } });
    expect(out).toEqual([true, false, true, true]);      // table 1 failed alone; 0/2/3 unaffected
  });

  it('out-of-turn / wrong-seat action is rejected, state not advanced', () => {
    const st = deal(randStacks(mulberry32(7), SEATS), 7, 1);
    const other = st.seats.find((s) => s.seat !== st.toAct && s.status === 'active')!.seat;
    const r = applyAction(st, { type: 'check', seat: other });
    expect(r.error).toBeTruthy();                         // not your turn
    expect(st.toAct).not.toBe(null);                      // original state still mid-hand
  });

  it('engine purity (idempotency-replay, engine half): same action twice → identical state, input unmutated', () => {
    const st = deal(randStacks(mulberry32(11), SEATS), 11, 1);
    const seat = st.toAct!;
    const la = legalActions(st, seat);
    const a: Action = { type: la.canCheck ? 'check' : 'call', seat };
    const before = JSON.stringify(toWirePublicState(st));
    const r1 = applyAction(st, a);
    const r2 = applyAction(st, a);
    expect(JSON.stringify(toWirePublicState(st))).toBe(before);  // pure: input untouched
    expect(JSON.stringify(toWirePublicState(r1.state)))
      .toBe(JSON.stringify(toWirePublicState(r2.state)));        // deterministic
    // NOTE: true RPC idempotency (replay of an idempotency_key → stored response) is a
    // runtime/DB property exercised by the Phase-D drill, not the pure engine.
  });
});
