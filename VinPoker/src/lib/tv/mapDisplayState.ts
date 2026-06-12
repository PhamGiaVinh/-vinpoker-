import type { TvData } from "@/types/tv";
import {
  mapTvData,
  type ClockRpcPayload,
  type TvLevelRow,
  type TvPrizeRow,
} from "@/lib/tv/mapTvData";

// get_tv_display_state envelope (contract: docs/agent-handoffs/tv-display-pairing.md).
// Field names deliberately mirror the PR B raw shapes so mapTvData is reused as-is.

export type TvDisplayStatus = "invalid" | "expired" | "unpaired" | "revoked" | "paired";

export interface TvDisplayConfig {
  id: string;
  name: string | null;
  zone: string | null;
  display_number: number | null;
  layout: string;
  theme: string;
  announcement: string | null;
  club_name: string | null;
}

export interface TvDisplayTournament {
  id: string;
  name: string;
  status: string;
  players_remaining: number | null;
  average_stack: number | null;
  prize_pool: number | null;
}

export interface TvDisplayStatePayload {
  status: TvDisplayStatus;
  display?: TvDisplayConfig;
  tournament?: TvDisplayTournament | null;
  clock?: ClockRpcPayload | null;
  levels?: TvLevelRow[] | null;
  entries?: { total_confirmed: number; total_buy_ins: number } | null;
  re_entries?: number | null;
  prizes?: TvPrizeRow[] | null;
}

export function parseDisplayStatePayload(data: unknown): TvDisplayStatePayload {
  if (!data || typeof data !== "object" || typeof (data as { status?: unknown }).status !== "string") {
    return { status: "invalid" };
  }
  return data as TvDisplayStatePayload;
}

/**
 * Paired display payload → frozen TvData contract. Null when the display has
 * no assigned tournament (standby) or the payload is not in a paired state.
 */
export function mapDisplayStateToTvData(
  payload: TvDisplayStatePayload,
  displayRemainingSeconds: number,
): TvData | null {
  if (payload.status !== "paired" || !payload.tournament || !payload.clock) return null;
  const t = payload.tournament;
  return mapTvData({
    clock: payload.clock,
    tournament: {
      name: t.name,
      status: t.status,
      players_remaining: t.players_remaining,
      average_stack: t.average_stack,
      prize_pool: t.prize_pool,
      club: payload.display?.club_name ? { name: payload.display.club_name } : null,
    },
    levels: payload.levels ?? [],
    // Same clamp as PR B: walk-ins may not exist in tournament_registrations.
    totalEntries: Math.max(payload.entries?.total_confirmed ?? 0, t.players_remaining ?? 0),
    totalBuyIns: payload.entries ? payload.entries.total_buy_ins : null,
    reEntries: payload.re_entries ?? null,
    prizes: payload.prizes ?? [],
    displayRemainingSeconds,
  });
}
