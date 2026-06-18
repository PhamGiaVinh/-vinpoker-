// tests/onlinePoker/edgeLog.test.ts
// G1 safety net for online-poker-action observability: buildLog is WHITELIST-ONLY, so a
// log line can never carry a secret (hole cards / deck / board_future / private view /
// JWT / email / RPC data) even if a caller passes one in. These run pure in vitest
// (log.ts has no Deno-only imports) so the guarantee is proven before any deploy.
import { describe, it, expect } from 'vitest';
import { buildLog, newCid, now, ALLOWED_FIELDS } from '../../supabase/functions/online-poker-action/log.ts';

describe('buildLog — whitelist keeps safe fields', () => {
  it('emits evt + all allowed fields when present', () => {
    const line = buildLog('op_done', {
      cid: 'c1', op: 'submit_action', hand_id: 'h1', table_id: 't1',
      outcome: 'ok', http: 200, ms: 138, attempt: 2,
    });
    const obj = JSON.parse(line);
    expect(obj).toEqual({
      evt: 'op_done', cid: 'c1', op: 'submit_action', hand_id: 'h1', table_id: 't1',
      outcome: 'ok', http: 200, ms: 138, attempt: 2,
    });
  });

  it('matches the documented op_done shape', () => {
    const obj = JSON.parse(buildLog('op_done', { cid: 'c', op: 'submit_action', hand_id: 'h', outcome: 'ok', attempt: 2, ms: 138 }));
    expect(obj.evt).toBe('op_done');
    expect(obj.cid).toBe('c');
    expect(obj.op).toBe('submit_action');
    expect(obj.outcome).toBe('ok');
    expect(obj.attempt).toBe(2);
  });

  it('matches the documented op_error shape', () => {
    const obj = JSON.parse(buildLog('op_error', { cid: 'c', op: 'submit_action', outcome: 'internal', ms: 92 }));
    expect(obj).toEqual({ evt: 'op_error', cid: 'c', op: 'submit_action', outcome: 'internal', ms: 92 });
    // never carries hand secrets / http when not provided
    expect(obj.hand_id).toBeUndefined();
  });

  it('rounds ms to an integer', () => {
    const obj = JSON.parse(buildLog('op_done', { cid: 'c', op: 'x', outcome: 'ok', ms: 138.7 }));
    expect(obj.ms).toBe(139);
  });

  it('omits undefined/null fields', () => {
    const obj = JSON.parse(buildLog('op_done', { cid: 'c', op: 'x', outcome: 'ok', hand_id: undefined, table_id: null }));
    expect('hand_id' in obj).toBe(false);
    expect('table_id' in obj).toBe(false);
  });
});

describe('buildLog — DROPS every non-whitelisted (secret) key (G1)', () => {
  it('drops hole cards / deck / board_future / private view / RPC data / body even if passed', () => {
    const line = buildLog('op_done', {
      cid: 'c', op: 'get_my_hole_cards', outcome: 'ok',
      // none of these may EVER reach a log line:
      holes: ['Ah', 'Kd'],
      myHoleCards: ['7c', '2s'],
      deck: ['As', '2d', '3c'],
      board_future: ['Qh', 'Jd'],
      revealedCards: ['9s', 'Ts'],
      data: { holes: ['Ah'] },
      body: { amount: '500' },
      view: { mySeat: 1 },
      jwt: 'eyJhbGc...secret',
      email: 'player@example.com',
      display_name: 'Bình',
      authorization: 'Bearer xxx',
    } as Record<string, unknown>);
    const obj = JSON.parse(line);
    for (const forbidden of ['holes', 'myHoleCards', 'deck', 'board_future', 'revealedCards', 'data', 'body', 'view', 'jwt', 'email', 'display_name', 'authorization']) {
      expect(forbidden in obj, `must not log "${forbidden}"`).toBe(false);
    }
    // the raw serialized text must not contain any card / secret value either
    for (const leak of ['Ah', 'Kd', '7c', 'Qh', 'eyJhbGc', 'player@example.com', 'Bình', 'Bearer']) {
      expect(line.includes(leak), `serialized log must not contain "${leak}"`).toBe(false);
    }
    // only the safe fields survived
    expect(obj).toEqual({ evt: 'op_done', cid: 'c', op: 'get_my_hole_cards', outcome: 'ok' });
  });

  it('ALLOWED_FIELDS is exactly the safe whitelist (no card/secret keys)', () => {
    expect([...ALLOWED_FIELDS].sort()).toEqual(
      ['attempt', 'cid', 'hand_id', 'http', 'ms', 'op', 'outcome', 'table_id'],
    );
  });
});

describe('newCid / now', () => {
  it('newCid returns a unique non-empty id each call', () => {
    const a = newCid();
    const b = newCid();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });

  it('now returns a number (ms clock)', () => {
    expect(typeof now()).toBe('number');
  });
});
