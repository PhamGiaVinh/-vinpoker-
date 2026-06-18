import { describe, it, expect } from 'vitest';
import { mapTournamentToEvent, summarizeInventory, type NativeTournamentRow } from './nativeData';

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

  it('always reports gtd as missing (no VinPoker column) — never guessed', () => {
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
