export type OpsIntelligenceScopeV1 =
  | { kind: "club" }
  | { kind: "daily"; tournamentId: string }
  | { kind: "festival"; festivalId: string }
  | { kind: "flight" | "final"; festivalId: string; tournamentId: string };

export interface TournamentContextV1 {
  tournamentId: string;
  name: string;
  status: string | null;
  startTime: string | null;
  buyIn: number | null;
  gtd: number | null;
  phase: string | null;
  flightLabel: string | null;
}
export interface FestivalContextV1 {
  festivalId: string;
  name: string;
  status: string | null;
  finalTournamentId: string | null;
  tournaments: TournamentContextV1[];
}
export interface OpsIntelligenceContextV1 {
  version: "ops-intelligence-context-v1";
  clubId: string;
  asOf: string;
  dailyTournaments: TournamentContextV1[];
  festivals: FestivalContextV1[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function fail(): never { throw new Error("CONTEXT_PAYLOAD_INVALID"); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !(key in result))) return fail();
  return result;
}
function text(value: unknown): string { return typeof value === "string" && value.trim().length > 0 ? value : fail(); }
function nullableText(value: unknown) { return value === null ? null : text(value); }
function uuid(value: unknown) { const id = text(value); return UUID.test(id) ? id.toLowerCase() : fail(); }
function time(value: unknown) {
  const result = text(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(result) || !Number.isFinite(Date.parse(result))) return fail();
  return new Date(result).toISOString() === (result.length === 20 ? result.replace("Z", ".000Z") : result) ? result : fail();
}
function money(value: unknown) { return value === null ? null : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : fail(); }

export function parseOpsIntelligenceContextV1(value: unknown, expectedClubId: string): OpsIntelligenceContextV1 {
  const root = record(value, ["version", "clubId", "asOf", "dailyTournaments", "festivals"]);
  if (root.version !== "ops-intelligence-context-v1" || uuid(root.clubId) !== uuid(expectedClubId)) return fail();
  const tournamentIds = new Set<string>();
  const tournament = (raw: unknown): TournamentContextV1 => {
    const row = record(raw, ["tournamentId", "name", "status", "startTime", "buyIn", "gtd", "phase", "flightLabel"]);
    const tournamentId = uuid(row.tournamentId);
    if (tournamentIds.has(tournamentId)) return fail();
    tournamentIds.add(tournamentId);
    return { tournamentId, name: text(row.name), status: nullableText(row.status), startTime: row.startTime === null ? null : time(row.startTime), buyIn: money(row.buyIn), gtd: money(row.gtd), phase: nullableText(row.phase), flightLabel: nullableText(row.flightLabel) };
  };
  const dailyTournaments = array(root.dailyTournaments).map(tournament);
  if (dailyTournaments.some((row) => row.phase !== null || row.flightLabel !== null)) return fail();
  const festivalIds = new Set<string>();
  const festivals = array(root.festivals).map((raw): FestivalContextV1 => {
    const row = record(raw, ["festivalId", "name", "status", "finalTournamentId", "tournaments"]);
    const festivalId = uuid(row.festivalId);
    if (festivalIds.has(festivalId)) return fail();
    festivalIds.add(festivalId);
    return { festivalId, name: text(row.name), status: nullableText(row.status), finalTournamentId: row.finalTournamentId === null ? null : uuid(row.finalTournamentId), tournaments: array(row.tournaments).map(tournament) };
  });
  return { version: root.version, clubId: uuid(root.clubId), asOf: time(root.asOf), dailyTournaments, festivals };
}

export function tournamentGaps(row: TournamentContextV1, linked: boolean): string[] {
  return [!row.startTime && "START_TIME_MISSING", row.buyIn === null && "BUY_IN_MISSING", row.gtd === null && "GTD_MISSING", linked && row.phase !== "flight" && row.phase !== "final" && "PHASE_UNSPECIFIED", linked && row.phase === "flight" && !row.flightLabel && "FLIGHT_LABEL_MISSING"].filter((item): item is string => typeof item === "string");
}
export function festivalGaps(row: FestivalContextV1): string[] {
  return [!row.tournaments.length && "NO_LINKED_TOURNAMENTS", !row.finalTournamentId && "FINAL_TOURNAMENT_MISSING", row.finalTournamentId && !row.tournaments.some((child) => child.tournamentId === row.finalTournamentId) && "FINAL_POINTER_NOT_IN_LINKED_SET"].filter((item): item is string => typeof item === "string");
}
export function scopeKey(scope: OpsIntelligenceScopeV1): string {
  if (scope.kind === "club") return "club";
  if (scope.kind === "daily") return `daily:${scope.tournamentId}`;
  if (scope.kind === "festival") return `festival:${scope.festivalId}`;
  return `${scope.kind}:${scope.festivalId}:${scope.tournamentId}`;
}
export function scopeForTournament(context: OpsIntelligenceContextV1, tournamentId: string): OpsIntelligenceScopeV1 | null {
  if (context.dailyTournaments.some((row) => row.tournamentId === tournamentId)) return { kind: "daily", tournamentId };
  for (const festival of context.festivals) {
    const child = festival.tournaments.find((row) => row.tournamentId === tournamentId);
    if (child?.phase === "flight" || child?.phase === "final") return { kind: child.phase, festivalId: festival.festivalId, tournamentId };
  }
  return null;
}
export function resolveIntelligenceScope(context: OpsIntelligenceContextV1 | null, scope: OpsIntelligenceScopeV1) {
  const festival = context && "festivalId" in scope ? context.festivals.find((row) => row.festivalId === scope.festivalId) ?? null : null;
  const tournament = context && "tournamentId" in scope ? (scope.kind === "daily" ? context.dailyTournaments : festival?.tournaments ?? []).find((row) => row.tournamentId === scope.tournamentId) ?? null : null;
  const valid = !!context && (scope.kind === "club" || (scope.kind === "festival" ? !!festival : !!tournament && (scope.kind === "daily" || tournament.phase === scope.kind)));
  return { valid, festival, tournament: valid ? tournament : null, tournamentId: valid ? tournament?.tournamentId ?? null : null };
}
