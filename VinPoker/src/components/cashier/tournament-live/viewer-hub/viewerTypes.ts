import type { HandFeedItem } from "./handFeedDerive";

export type ViewerTab = "updates" | "hands" | "prizes" | "structure" | "photos";

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
  linkedHandNumber?: number | null;
  isPinned?: boolean;
  publishedAt: string;
  sourceLabel?: string | null;
}

export type ViewerFeedItem =
  | { kind: "editorial"; id: string; occurredAt: string; post: TournamentPostViewModel }
  | { kind: "hand"; id: string; occurredAt: string; hand: HandFeedItem };
