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
  /** Pre-built Vietnamese label (fallback for non-i18n contexts + tests). */
  label: string;
  kind: HubFeedKind;
  /** Raw action_type + amount so the view can build a localized label via i18n. */
  actionType?: string;
  amount?: number;
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

// ── Tournament-wide STORY feed (#4 PR1) ─────────────────────────────────────
// A persistent feed of TOURNAMENT-level events (separate from the current-hand
// action ticker): player eliminations, players-remaining milestones, final table.
// MVP = only events that are CERTAIN from the data. We never name a killer or a
// "winner" (the DB stores neither) and never infer level-ups.

export type HubStoryKind = "elimination" | "milestone" | "final_table" | "bubble" | "itm";

export interface HubStoryItem {
  id: string;
  kind: HubStoryKind;
  /** Pre-built vi label — fallback for non-i18n contexts + tests. */
  label: string;
  /** Structured fields so the view can build a localized label. */
  name?: string;
  count?: number;
}

/** Minimal shape of a recent `hand_players` row used to detect eliminations. */
export interface RawHandPlayer {
  player_id: string;
  hand_id: string;
  is_eliminated?: boolean | null;
  created_at?: string | null;
}

// Players-remaining milestones, descending. Final table (≤9) is its own event.
const MILESTONE_THRESHOLDS = [100, 50, 27, 18, 9, 3, 2];

/**
 * Eliminations from recent `hand_players` rows (expected NEWEST-first). Each item
 * has a STABLE id `elim:{hand_id}:{player_id}` so the hook can dedup across polls.
 * Copy is "{name} bị loại — còn {N} người" — never "A loại B" / "thắng" (the DB
 * stores no killer/winner).
 */
export function deriveEliminations(
  rows: RawHandPlayer[],
  nameByPlayer: Map<string, string>,
  playersRemaining: number | null,
): HubStoryItem[] {
  const out: HubStoryItem[] = [];
  for (const r of rows || []) {
    if (!r.is_eliminated) continue;
    const name = nameByPlayer.get(r.player_id) || r.player_id.slice(0, 6);
    const n = playersRemaining;
    out.push({
      id: `elim:${r.hand_id}:${r.player_id}`,
      kind: "elimination",
      name,
      count: n ?? undefined,
      label: n != null ? `${name} bị loại — còn ${n} người` : `${name} bị loại`,
    });
  }
  return out;
}

/**
 * Players-remaining MILESTONE + FINAL-TABLE events, emitted ONCE per threshold
 * crossed — the caller passes a persistent `seen` set (mutated here) so a value
 * is never re-announced. At most one milestone item per call (the most
 * significant newly-crossed threshold), so a multi-bust poll never spams. Final
 * table prefers the official `status`, else falls back to ≤9 on a single table.
 */
export function deriveMilestones(
  playersRemaining: number | null,
  activeTableCount: number,
  status: string | null | undefined,
  seen: Set<string>,
): HubStoryItem[] {
  const out: HubStoryItem[] = [];
  const n = playersRemaining;

  const isFinalTable =
    status === "final_table" || (n != null && n <= 9 && activeTableCount === 1);
  if (isFinalTable && !seen.has("final_table")) {
    seen.add("final_table");
    out.push({
      id: "story:final_table",
      kind: "final_table",
      count: n ?? undefined,
      label: n != null ? `Final table — còn ${n} người` : "Final table",
    });
  }

  if (n != null) {
    let crossed: number | null = null;
    for (const th of MILESTONE_THRESHOLDS) {
      const key = `ms:${th}`;
      if (n <= th && !seen.has(key)) {
        seen.add(key);
        crossed = th; // descending → ends on the smallest threshold still ≥ n
      }
    }
    if (crossed != null) {
      out.push({ id: `story:ms:${crossed}`, kind: "milestone", count: n, label: `Còn ${n} người` });
    }
  }
  return out;
}

/**
 * BUBBLE + ITM events, from the Floor-Ops prize structure's paid places.
 * `itmPlaces` should be MAX(tournament_prizes.position) (robust to non-contiguous
 * positions), falling back to tournaments.itm_places. Each event fires ONCE via
 * the persistent `seen` set. Returns nothing when payouts aren't configured
 * (`itmPlaces` null/≤0) — no false events. Bubble is the EXACT one-off-the-money
 * moment; ITM fires the first time the field is at/below the paid places, so a
 * multi-bust hand that skips the exact bubble still announces ITM.
 */
export function deriveBubbleItm(
  playersRemaining: number | null,
  itmPlaces: number | null,
  seen: Set<string>,
): HubStoryItem[] {
  const out: HubStoryItem[] = [];
  const n = playersRemaining;
  if (n == null || itmPlaces == null || itmPlaces <= 0) return out;

  if (n === itmPlaces + 1 && !seen.has("bubble")) {
    seen.add("bubble");
    out.push({ id: "story:bubble", kind: "bubble", count: n, label: `Đang ở bubble — còn ${n} người` });
  }
  if (n <= itmPlaces && !seen.has("itm")) {
    seen.add("itm");
    out.push({ id: "story:itm", kind: "itm", count: n, label: `Đã vào tiền — còn ${n} người` });
  }
  return out;
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
    actionType: a.action_type,
    amount: a.action_amount || 0,
  }));
}
