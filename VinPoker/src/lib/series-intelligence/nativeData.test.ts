import { describe, it, expect } from 'vitest';
import {
  mapRpcRowToEvent,
  mapTournamentToEvent,
  summarizeInventory,
  type ClubSeriesEventRow,
  type NativeTournamentRow,
} from './nativeData';

function row(p: Partial<NativeTournamentRow>): NativeTournamentRow {
  return {
    id: 't1',
    name: 'Daily',
    start_time: '2026-05-01T11:00:00Z',
    buy_in: 1_100_000,
    rake_amount: 100_000,
    service_fee_amount: 0,
    prize_pool: 50_000_000,
    club_id: 'club-A',
    ...p,
  };
}

describe('mapTournamentToEvent', () => {
  it('maps direct fields and sets source=native', () => {
    const e = mapTournamentToEvent(row({}));
    expect(e.event_id).toBe('t1');
    expect(e.event_name).toBe('Daily');
    expect(e.event_date).toBe('2026-05-01T11:00:00Z');
    expect(e.buy_in).toBe(1_100_000);
    expect(e.fee).toBe(100_000); // = rake_amount
    expect(e.prize_pool_actual).toBe(50_000_000);
    expect(e.source).toBe('native');
    expect(e.clubId).toBe('club-A');
  });

  it('reports gtd missing when no GTD value is provided — never guessed', () => {
    const e = mapTournamentToEvent(row({}));
    expect(e.gtd).toBeNull();
    expect(e.missingFields).toContain('gtd');
  });

  it('reports entries missing when no counts are provided — does not invent them', () => {
    const e = mapTournamentToEvent(row({}));
    expect(e.total_entries).toBeNull();
    expect(e.unique_entries).toBeNull();
    expect(e.reentries).toBeNull();
    expect(e.missingFields).toEqual(expect.arrayContaining(['total_entries', 'unique_entries', 'reentries']));
  });

  it('uses real entry counts when passed (still never derives absent ones)', () => {
    const e = mapTournamentToEvent(row({}), { totalEntries: 60, uniqueEntries: 42, reentries: 18 });
    expect(e.total_entries).toBe(60);
    expect(e.unique_entries).toBe(42);
    expect(e.reentries).toBe(18);
    expect(e.missingFields).not.toContain('total_entries');
  });

  it('carries serviceFeeAmount separately (not summed into fee)', () => {
    const e = mapTournamentToEvent(row({ rake_amount: 100_000, service_fee_amount: 50_000 }));
    expect(e.fee).toBe(100_000);
    expect(e.serviceFeeAmount).toBe(50_000);
  });

  it('reports missing direct fields when null', () => {
    const e = mapTournamentToEvent(row({ buy_in: null, prize_pool: null, name: null }));
    expect(e.missingFields).toEqual(expect.arrayContaining(['buy_in', 'prize_pool_actual', 'event_name']));
  });
});

describe('summarizeInventory + cross-club safety', () => {
  it('counts per scoped set without merging across clubs', () => {
    const events = [
      mapTournamentToEvent(row({ id: 'a', club_id: 'club-A' })),
      mapTournamentToEvent(row({ id: 'b', club_id: 'club-A', prize_pool: null })),
      mapTournamentToEvent(row({ id: 'c', club_id: 'club-B' })), // different club preserved
    ];
    // each event keeps its own club id — the adapter never merges clubs
    expect(events.map((e) => e.clubId)).toEqual(['club-A', 'club-A', 'club-B']);

    const s = summarizeInventory(events);
    expect(s.total).toBe(3);
    expect(s.withBuyIn).toBe(3);
    expect(s.withPrizePool).toBe(2); // event 'b' has none
    expect(s.missingPrizePool).toBe(1);
    expect(s.missingGtd).toBe(3); // gtd missing for all native rows
    expect(s.missingEntries).toBe(3); // no counts provided
  });
});

describe('mapRpcRowToEvent (get_club_series_events RPC → event shape)', () => {
  function rpcRow(p: Partial<ClubSeriesEventRow>): ClubSeriesEventRow {
    return {
      event_id: 'e1',
      event_name: 'Sunday Major',
      event_date: '2026-05-03T10:00:00Z',
      buy_in: 2_200_000,
      fee: 200_000, // = rake_amount, server-side
      service_fee: 50_000,
      gtd: null,
      prize_pool_actual: 80_000_000,
      total_entries: 120,
      unique_entries: 90,
      reentries: 30,
      club_id: 'club-A',
      ...p,
    };
  }

  it('maps an RPC row into the native event shape (source=native)', () => {
    const e = mapRpcRowToEvent(rpcRow({}));
    expect(e.event_id).toBe('e1');
    expect(e.event_name).toBe('Sunday Major');
    expect(e.event_date).toBe('2026-05-03T10:00:00Z');
    expect(e.buy_in).toBe(2_200_000);
    expect(e.prize_pool_actual).toBe(80_000_000);
    expect(e.source).toBe('native');
    expect(e.clubId).toBe('club-A');
  });

  it('uses the server-derived entry counts (total / unique / reentries)', () => {
    const e = mapRpcRowToEvent(rpcRow({ total_entries: 120, unique_entries: 90, reentries: 30 }));
    expect(e.total_entries).toBe(120);
    expect(e.unique_entries).toBe(90);
    expect(e.reentries).toBe(30);
    expect(e.missingFields).not.toContain('total_entries');
    expect(e.missingFields).not.toContain('unique_entries');
    expect(e.missingFields).not.toContain('reentries');
  });

  it('treats 0 entries as a real server count, not missing', () => {
    const e = mapRpcRowToEvent(rpcRow({ total_entries: 0, unique_entries: 0, reentries: 0 }));
    expect(e.total_entries).toBe(0);
    expect(e.missingFields).not.toContain('total_entries');
  });

  it('keeps fee (= RPC rake) and service_fee separate — never summed', () => {
    const e = mapRpcRowToEvent(rpcRow({ fee: 200_000, service_fee: 50_000 }));
    expect(e.fee).toBe(200_000);
    expect(e.serviceFeeAmount).toBe(50_000);
    expect(e.fee).not.toBe(250_000); // fee must not absorb the service fee
  });

  it('reports gtd missing when the RPC sends null (no GTD set) — never faked', () => {
    const e = mapRpcRowToEvent(rpcRow({ gtd: null }));
    expect(e.gtd).toBeNull();
    expect(e.missingFields).toContain('gtd');
  });

  it('uses the real committed GTD from the RPC when present (not missing)', () => {
    const e = mapRpcRowToEvent(rpcRow({ gtd: 300_000_000 }));
    expect(e.gtd).toBe(300_000_000);
    expect(e.missingFields).not.toContain('gtd');
  });

  it('reports a missing direct field (e.g. buy_in null) without inventing it', () => {
    const e = mapRpcRowToEvent(rpcRow({ buy_in: null }));
    expect(e.buy_in).toBeNull();
    expect(e.missingFields).toContain('buy_in');
  });
});
