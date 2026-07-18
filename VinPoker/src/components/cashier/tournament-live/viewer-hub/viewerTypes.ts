import type { HandFeedItem } from "./handFeedDerive";

export type ViewerTab = "updates" | "hands" | "prizes" | "structure" | "photos";

export type ViewerStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface ViewerActionItem {
  actionId: string;
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  seatNumber: number;
  street: ViewerStreet;
  actionType: string;
  amount: number;
  potAfter: number;
  actionOrder: number;
}

export interface PublicTournamentSummary {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  guarantee: number | null;
  buyIn: number | null;
  playersRemaining: number | null;
  currentLevel: number | null;
}

export interface PublicClockSummary extends PublicTournamentSummary {
  smallBlind: number;
  bigBlind: number;
  bigBlindAnte: number;
  levelEndsAt: string | null;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  nextBigBlindAnte: number | null;
  entries: number;
  averageStack: number | null;
}

export interface TournamentResultView {
  place: number;
  prize: number;
  playerName: string | null;
  avatarUrl: string | null;
  status: "official" | "provisional" | "open";
}

export type TournamentPostKind = "commentary" | "announcement";

/**
 * UI-only contract for the future tournament_posts read adapter. The Viewer does
 * not fetch or write these rows in this phase; Grok can map the owner-gated DB
 * contract into this shape without coupling the presentational components to it.
 */
export interface TournamentPostViewModel {
  id: string;
  tournamentId: string;
  kind: TournamentPostKind;
  titleVi?: string | null;
  titleEn?: string | null;
  bodyVi: string;
  bodyEn?: string | null;
  coverPhotoUrl?: string | null;
  linkedHandId?: string | null;
  linkedHandTableId?: string | null;
  linkedHandNumber?: number | null;
  isPinned?: boolean;
  publishedAt: string;
  sourceLabel?: string | null;
}

export type ViewerFeedItem =
  | { kind: "editorial"; id: string; occurredAt: string; post: TournamentPostViewModel }
  | { kind: "hand"; id: string; occurredAt: string; hand: HandFeedItem };
