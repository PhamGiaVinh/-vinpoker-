// Series Intelligence — native data adapter (Phase 1, read-only, PURE).
// Maps an existing VinPoker `tournaments` row into the Club Intelligence event
// shape. It NEVER fabricates a value: any field VinPoker does not have is left
// null and listed in `missingFields`. Entry counts are derived from registrations
// only when real counts are passed in — never invented. No economics computed here.

/** Minimal subset of the `tournaments` Row this adapter needs (decoupled from generated types). */
export interface NativeTournamentRow {
  id: string;
  name: string | null;
  start_time: string | null;
  buy_in: number | null;
  rake_amount: number | null;
  service_fee_amount: number | null;
  prize_pool: number | null;
  club_id: string;
}

/** Real entry counts derived server-side / from registration rows (Phase 2). Never guessed. */
export interface EntryCounts {
  totalEntries: number | null;
  uniqueEntries: number | null;
  reentries: number | null;
}

export type EventSource = 'native' | 'csv';

export interface SeriesEvent {
  event_id: string;
  event_name: string | null;
  event_date: string | null;
  buy_in: number | null;
  fee: number | null; // = rake_amount (the rake / club fee)
  serviceFeeAmount: number | null; // separate per-entry service fee (reported, not summed)
  gtd: number | null; // MISSING in VinPoker schema — always null for native rows
  prize_pool_actual: number | null;
  total_entries: number | null;
  unique_entries: number | null;
  reentries: number | null;
  source: EventSource;
  clubId: string;
  missingFields: string[];
}

/**
 * Map one native tournament row → SeriesEvent. `entryCounts` is optional; when
 * absent, entries are reported missing (NOT derived/guessed here).
 */
export function mapTournamentToEvent(row: NativeTournamentRow, entryCounts?: EntryCounts): SeriesEvent {
  const missingFields: string[] = [];
  const need = (field: string, value: unknown): void => {
    if (value === null || value === undefined) missingFields.push(field);
  };

  const buy_in = row.buy_in ?? null;
  const fee = row.rake_amount ?? null;
  const prize_pool_actual = row.prize_pool ?? null;

  // GTD has no column in VinPoker `tournaments` → always missing for native rows.
  const gtd: number | null = null;
  missingFields.push('gtd');

  const total_entries = entryCounts?.totalEntries ?? null;
  const unique_entries = entryCounts?.uniqueEntries ?? null;
  const reentries = entryCounts?.reentries ?? null;

  need('event_name', row.name);
  need('event_date', row.start_time);
  need('buy_in', buy_in);
  need('fee', fee);
  need('prize_pool_actual', prize_pool_actual);
  need('total_entries', total_entries);
  need('unique_entries', unique_entries);
  need('reentries', reentries);

  return {
    event_id: row.id,
    event_name: row.name ?? null,
    event_date: row.start_time ?? null,
    buy_in,
    fee,
    serviceFeeAmount: row.service_fee_amount ?? null,
    gtd,
    prize_pool_actual,
    total_entries,
    unique_entries,
    reentries,
    source: 'native',
    clubId: row.club_id,
    missingFields,
  };
}

export interface InventorySummary {
  total: number;
  withBuyIn: number;
  withFee: number;
  withPrizePool: number;
  missingGtd: number;
  missingPrizePool: number;
  missingEntries: number; // events missing ANY of total/unique/reentries
}

/** Count-only summary over already club-scoped events. No aggregation across clubs. */
export function summarizeInventory(events: SeriesEvent[]): InventorySummary {
  return {
    total: events.length,
    withBuyIn: events.filter((e) => e.buy_in !== null).length,
    withFee: events.filter((e) => e.fee !== null).length,
    withPrizePool: events.filter((e) => e.prize_pool_actual !== null).length,
    missingGtd: events.filter((e) => e.gtd === null).length,
    missingPrizePool: events.filter((e) => e.prize_pool_actual === null).length,
    missingEntries: events.filter(
      (e) => e.total_entries === null || e.unique_entries === null || e.reentries === null,
    ).length,
  };
}
