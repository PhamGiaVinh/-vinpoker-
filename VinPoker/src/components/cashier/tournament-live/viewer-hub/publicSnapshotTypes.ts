export type PublicSnapshotSection = "tables" | "ranking" | "payout";

export interface PublicFreshness {
  sourceRevision: string;
  projectedSourceRevision: string;
  sourceChangedAt: string | null;
  publishedAt: string | null;
  serverCheckedAt: string;
  oldestPendingAt: string | null;
  state: "current" | "updating" | "stale";
}

export interface PublicTablePlayer {
  entryId: string | null;
  playerId: string;
  entryNumber: number;
  seatNumber: number;
  name: string;
  avatarUrl: string | null;
  stack: number | null;
  holeCards: string[];
}

export interface PublicTableSnapshot {
  tableId: string;
  tableSessionId: string | null;
  name: string;
  handId: string | null;
  handNumber: number | null;
  buttonSeat: number | null;
  street: string | null;
  board: string[] | null;
  pot: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  latestAction?: {
    playerId: string;
    entryNumber: number;
    actionType: string;
    amount: number | null;
  } | null;
  players: PublicTablePlayer[];
  trackerState: "live" | "idle" | "unavailable";
}

export interface PublicTableCatalogItem {
  tableId: string;
  name: string;
  playerCount: number;
  searchPlayers: string[];
}

export interface PublicRankingRow {
  entryId: string | null;
  playerId: string;
  entryNumber: number;
  name: string;
  avatarUrl: string | null;
  chips: number | null;
  updatedAt: string | null;
}

export interface PublicPayoutRow {
  fromPlace: number;
  toPlace: number;
  amountPerPlayer: number;
  playerName: string | null;
  avatarUrl: string | null;
  resultStatus: "official" | "open";
}

export interface PublicSpectatorSnapshot {
  ok: boolean;
  access: "public" | "revoked";
  tournamentId: string;
  sections: {
    tables?: { revision: string; freshness: PublicFreshness; catalog: PublicTableCatalogItem[]; items: PublicTableSnapshot[]; removed: string[]; unchanged: boolean };
    ranking?: { revision: string; freshness: PublicFreshness; bigBlind: number | null; items: PublicRankingRow[]; unchanged: boolean };
    payout?: { revision: string; freshness: PublicFreshness; items: PublicPayoutRow[]; unchanged: boolean; published: boolean };
  };
}
