// Pure derivations for the public Live Hub (Increment B). No React, no supabase,
// no imports — fully unit-testable in isolation. The hook (useLiveTrackerData)
// fetches the rows and feeds them through these.

export interface RawSeat {
  player_id: string;
  seat_number: number;
  player_name?: string | null;
  table_id?: string | null;
  is_active?: boolean | null;
  chip_count?: number | null;
}

export interface RawAction {
  id?: string | number;
  player_id: string;
  action_type: string;
  action_amount?: number | null;
  action_order: number;
}

export interface HubTableSummary {
  tableId: string;
  name: string;
  playerCount: number;
}

export type HubFeedKind = "allin" | "raise" | "bet" | "call" | "check" | "fold" | "post" | "action";

export interface HubFeedItem {
  id: string;
  seatNumber: number;
  playerName: string;
  label: string;
  kind: HubFeedKind;
}

/** Compact chip/amount formatter (1.2k, 3.4M) shared by the feed + stats bar. */
export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** Active, seated players only (a seat with no player_id is empty). */
export function activeSeats(seats: RawSeat[]): RawSeat[] {
  return (seats || []).filter((s) => s.is_active !== false && !!s.player_id);
}

/** Distinct live tables (by table_id) with player counts, name-sorted. */
export function deriveTables(seats: RawSeat[], tableNames: Record<string, string>): HubTableSummary[] {
  const byTable = new Map<string, number>();
  for (const s of activeSeats(seats)) {
    const t = s.table_id;
    if (!t) continue;
    byTable.set(t, (byTable.get(t) || 0) + 1);
  }
  return [...byTable.entries()]
    .map(([tableId, playerCount]) => ({
      tableId,
      name: tableNames[tableId] || `Bàn ${tableId.slice(0, 4)}`,
      playerCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface HubChipLeader {
  playerName: string;
  seatNumber: number;
  chipCount: number;
}

/**
 * The active player with the most chips ("chip leader"), across all tables.
 * Returns null when no seated player has a positive stack (e.g. chip_count not
 * tracked). Ties resolve to the first seat encountered — deterministic.
 */
export function deriveChipLeader(seats: RawSeat[]): HubChipLeader | null {
  let best: RawSeat | null = null;
  let bestChips = 0;
  for (const s of activeSeats(seats)) {
    const chips = s.chip_count ?? 0;
    if (chips > bestChips) {
      best = s;
      bestChips = chips;
    }
  }
  if (!best) return null;
  return {
    playerName: best.player_name || best.player_id.slice(0, 6),
    seatNumber: best.seat_number,
    chipCount: bestChips,
  };
}

export function feedKind(actionType: string): HubFeedKind {
  switch (actionType) {
    case "all_in": return "allin";
    case "raise": return "raise";
    case "bet": return "bet";
    case "call": return "call";
    case "check": return "check";
    case "fold": return "fold";
    case "post_sb":
    case "post_bb":
    case "post_ante": return "post";
    default: return "action";
  }
}

export function feedLabel(actionType: string, amount: number): string {
  const a = fmtCompact(amount || 0);
  switch (actionType) {
    case "all_in": return `ALL-IN ${a}`;
    case "raise": return `Tố ${a}`;
    case "bet": return `Cược ${a}`;
    case "call": return `Theo ${a}`;
    case "check": return "Check";
    case "fold": return "Bỏ bài";
    case "post_sb": return `SB ${a}`;
    case "post_bb": return `BB ${a}`;
    case "post_ante": return `Ante ${a}`;
    default: return `${actionType} ${a}`;
  }
}

/**
 * Map already-loaded hand actions (expected NEWEST-first) into feed rows.
 * Player display names come from the seats' player_name.
 */
export function deriveFeed(
  actions: RawAction[],
  nameByPlayer: Map<string, string>,
  seatByPlayer: Map<string, number>,
): HubFeedItem[] {
  return (actions || []).map((a) => ({
    id: String(a.id ?? `${a.player_id}-${a.action_order}`),
    seatNumber: seatByPlayer.get(a.player_id) ?? 0,
    playerName: nameByPlayer.get(a.player_id) || a.player_id.slice(0, 6),
    label: feedLabel(a.action_type, a.action_amount || 0),
    kind: feedKind(a.action_type),
  }));
}
