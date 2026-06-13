// tests/pokerAdapter/serialize.more.test.ts
// GE-2C adapter — extended PURE coverage beyond serialize.test.ts / secrecy.test.ts:
//   * lossless round-trip driven to hand completion (result + showdown reveals)
//   * dbMap pure maps (seat inputs, hand config, action <-> row, event rows)
//   * secrecy at showdown (revealedCards public; hole cards still never leak)
//   * deeper fail-closed deserialization (more tampered chip fields)
//   * N2 contract guard: the wire carries sitting_out seats UNFILTERED — the
//     reason op_submit_action's chip-conservation sum must filter by status.

import { describe, it, expect } from 'vitest';
import {
  createHand, applyAction, legalActions, makeDeck, SCHEMA_VERSION,
} from '@engine/index.ts';
import type { Action, HandState, LegalActions, HandEvent } from '@engine/index.ts';
import {
  serializeAuthoritative, deserializeAuthoritative,
  buildSeatInputs, buildHandConfig, actionToRow, actionFromRow, eventRows,
  ENGINE_VERSION,
  type SeatRow, type TableRow,
} from '../../supabase/functions/_shared/pokerAdapter/index.ts';
import { freshHand, si, makeState, baseSeat } from '../pokerEngine/fixtures.ts';

/** Chip-conserving legal pick: check > call > fold (drives a hand to completion). */
function pick(la: LegalActions, seat: number): Action {
  if (la.canCheck) return { type: 'check', seat };
  if (la.types.includes('call')) return { type: 'call', seat };
  return { type: 'fold', seat };
}

/** Drive a hand to the end (or `max` actions), round-tripping the state each step. */
function driveChecked(start: HandState, max = 40): HandState {
  let st = start;
  for (let i = 0; i < max && st.status === 'betting' && st.toAct != null; i++) {
    const r = applyAction(st, pick(legalActions(st, st.toAct), st.toAct));
    if (r.error) break;
    st = r.state;
  }
  return st;
}

/** jsonb storage simulation: object -> JSON text -> object. */
const through = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe('adapter — lossless round-trip to completion (result + reveals)', () => {
  it('serializes/deserializes a COMPLETED hand identically (covers result + revealedCards)', () => {
    const base = freshHand([1000n, 1000n, 1000n], { button: 1, sb: 25n, bb: 50n });
    const done = driveChecked(base);
    expect(done.status).toBe('complete');      // check-down reached showdown/settlement
    expect(done.result).toBeDefined();          // exercises resultFromWire on the way back

    const split = serializeAuthoritative(done);
    const restored = deserializeAuthoritative(through(split.stateJson), split.liveDeck, split.holes);
    expect(restored).toEqual(done);             // identity incl. result + sidePots + per-seat revealedCards
  });

  it('round-trips losslessly at EVERY intermediate step of a hand', () => {
    let st = freshHand([800n, 800n, 800n, 800n], { button: 2, sb: 25n, bb: 50n });
    for (let i = 0; i < 30 && st.status === 'betting' && st.toAct != null; i++) {
      const split = serializeAuthoritative(st);
      const restored = deserializeAuthoritative(through(split.stateJson), split.liveDeck, split.holes);
      expect(restored).toEqual(st);
      const r = applyAction(st, pick(legalActions(st, st.toAct), st.toAct));
      if (r.error) break;
      st = r.state;
    }
  });
});

describe('adapter secrecy at showdown', () => {
  it('public state may reveal revealedCards but NEVER carries holeCards', () => {
    const done = driveChecked(freshHand([1000n, 1000n, 1000n], { button: 1, sb: 25n, bb: 50n }));
    const split = serializeAuthoritative(done);
    const json = JSON.stringify(split.stateJson);
    // no hole-card channel in the public projection, ever
    expect(json).not.toContain('holeCards');
    // any seat that did NOT legitimately reveal must not have its cards in public:
    // compare against the full hole set; revealed seats expose via `revealedCards`,
    // but the `holeCards` field name itself must be wholly absent (checked above),
    // and the SECRET split is where every hole card lives.
    expect(split.holes.length).toBeGreaterThan(0);
    for (const h of split.holes) expect(h.cards).toHaveLength(2);
  });

  it('a folded seat’s hole cards never appear in the public projection', () => {
    // 3-handed: drive a couple of actions so at least the option to fold exists,
    // then assert no `holeCards` key regardless of fold/active mix.
    let st = freshHand([1000n, 1000n, 1000n], { button: 1, sb: 25n, bb: 50n });
    const r = applyAction(st, { type: 'fold', seat: st.toAct! });
    if (!r.error) st = r.state;
    expect(JSON.stringify(serializeAuthoritative(st).stateJson)).not.toContain('holeCards');
  });
});

describe('adapter dbMap — pure row <-> engine maps', () => {
  it('buildSeatInputs: keeps sitting/sitting_out, drops empty/null, parses TEXT stacks', () => {
    const rows: SeatRow[] = [
      { seat_no: 1, user_id: 'u1', stack: '1500', status: 'sitting' },
      { seat_no: 2, user_id: 'u2', stack: 2000, status: 'sitting_out' },
      { seat_no: 3, user_id: null, stack: 0, status: 'empty' },
      { seat_no: 4, user_id: 'u4', stack: '0', status: 'empty' }, // status empty => dropped even with a user
    ];
    const inputs = buildSeatInputs(rows);
    expect(inputs).toEqual([
      { seat: 1, playerId: 'u1', stack: 1500n, sittingOut: false },
      { seat: 2, playerId: 'u2', stack: 2000n, sittingOut: true },
    ]);
  });

  it('buildSeatInputs: rejects a precision-lossy chip number (must read stacks as TEXT)', () => {
    const bad: SeatRow[] = [{ seat_no: 1, user_id: 'u1', stack: Number.MAX_SAFE_INTEGER + 2, status: 'sitting' }];
    expect(() => buildSeatInputs(bad)).toThrow();
  });

  it('buildHandConfig: maps table row + ids and pins SCHEMA_VERSION', () => {
    const table: TableRow = { id: 't1', sb: '25', bb: '50' };
    const cfg = buildHandConfig(table, 'h1', 7, 3);
    expect(cfg).toEqual({
      handId: 'h1', tableId: 't1', handNo: 7, buttonSeat: 3,
      sb: 25n, bb: 50n, schemaVersion: SCHEMA_VERSION,
    });
  });

  it('actionToRow <-> actionFromRow round-trips (chip as decimal string)', () => {
    const withAmt: Action = { type: 'raise', seat: 4, amount: 150n };
    const row = actionToRow(withAmt);
    expect(row).toEqual({ type: 'raise', seat: 4, amount: '150' });
    expect(actionFromRow(row as { type: Action['type']; seat: number; amount?: string })).toEqual(withAmt);

    const noAmt: Action = { type: 'check', seat: 2 };
    const row2 = actionToRow(noAmt);
    expect('amount' in row2).toBe(false);
    expect(actionFromRow(row2 as { type: Action['type']; seat: number })).toEqual(noAmt);
  });

  it('actionFromRow: rejects a non-canonical chip amount (fail-closed)', () => {
    for (const amount of ['1.5', '-1', '', '007', '1e3']) {
      expect(() => actionFromRow({ type: 'bet', seat: 1, amount })).toThrow();
    }
  });

  it('eventRows: assigns seq continuing from startSeq', () => {
    const base = freshHand([1000n, 1000n], { button: 1, sb: 25n, bb: 50n });
    const r = applyAction(base, pick(legalActions(base, base.toAct!), base.toAct!));
    const events: HandEvent[] = r.events;
    expect(events.length).toBeGreaterThan(0);
    const rows = eventRows('hX', 5, events);
    expect(rows.map((e) => e.event_seq)).toEqual(events.map((_, i) => 5 + i));
    expect(rows.every((e) => e.hand_id === 'hX')).toBe(true);
  });

  it('ENGINE_VERSION is the expected build tag', () => {
    expect(ENGINE_VERSION).toBe('ge-1.6');
  });
});

describe('adapter deserialize — deeper fail-closed', () => {
  it('rejects tampered top-level chip fields (currentBet / lastFullRaiseSize)', () => {
    const split = serializeAuthoritative(freshHand([1000n, 1000n, 1000n], { button: 1 }));
    for (const field of ['currentBet', 'lastFullRaiseSize'] as const) {
      const bad = through(split.stateJson) as unknown as Record<string, string>;
      bad[field] = '1.25';
      expect(() => deserializeAuthoritative(bad as never, split.liveDeck, split.holes)).toThrow();
    }
  });

  it('rejects a tampered config chip field (sb)', () => {
    const split = serializeAuthoritative(freshHand([1000n, 1000n], { button: 1 }));
    const bad = through(split.stateJson);
    (bad.config as unknown as Record<string, string>).sb = '-5';
    expect(() => deserializeAuthoritative(bad, split.liveDeck, split.holes)).toThrow();
  });

  it('rejects a tampered per-seat stack', () => {
    const split = serializeAuthoritative(freshHand([1000n, 1000n], { button: 1 }));
    const bad = through(split.stateJson);
    (bad.seats[0] as unknown as Record<string, string>).stack = '99.9';
    expect(() => deserializeAuthoritative(bad, split.liveDeck, split.holes)).toThrow();
  });
});

describe('adapter — N2 contract guard (sitting_out seats are carried UNFILTERED)', () => {
  // The wire projection faithfully includes seats with status 'sitting_out'. The
  // adapter does NOT drop them — which is exactly why op_submit_action's chip-
  // conservation sum must filter by status IN ('active','folded','allin') (see
  // GE2C_SECURITY_REVIEW.md §N2). This test pins that contract so a future change
  // that silently pre-filters the wire (and would mask the RPC asymmetry) is caught.
  it('serializeAuthoritative keeps a sitting_out seat in the public wire seats', () => {
    const state = makeState({
      street: 'preflop',
      status: 'betting',
      toAct: 2,
      seats: [
        baseSeat({ seat: 1, status: 'active', stack: 900n, committed: 50n, totalCommitted: 50n }),
        baseSeat({ seat: 2, status: 'active', stack: 950n, committed: 25n, totalCommitted: 25n }),
        baseSeat({ seat: 3, status: 'sitting_out', stack: 1000n }), // present, not dealt in
      ],
      pot: 75n,
    });
    const wire = serializeAuthoritative(state).stateJson;
    const seatNos = wire.seats.map((s) => s.seat).sort((a, b) => a - b);
    expect(seatNos).toEqual([1, 2, 3]);
    const sittingOut = wire.seats.find((s) => s.seat === 3)!;
    expect(sittingOut.status).toBe('sitting_out');
    expect(sittingOut.stack).toBe('1000'); // its stack IS in the wire -> RPC must exclude it from Σ
  });
});
