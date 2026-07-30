import type {
  TrackerOpsFailureCodeV2,
  TrackerTableSummaryV2,
} from "./contracts";

export type TrackerHandInputRouteV2 =
  | {
      kind: "launcher";
      tournament_id: string;
      canonical_href: string;
      needs_replace: boolean;
    }
  | {
      kind: "table";
      tournament_id: string;
      tournament_table_id: string;
      canonical_href: string;
      needs_replace: boolean;
    }
  | {
      kind: "error";
      error: TrackerOpsFailureCodeV2 | "missing_tournament";
    };

export function buildTrackerHandInputHrefV2(
  tournamentId: string,
  tournamentTableId?: string | null,
): string {
  const params = new URLSearchParams({ t: tournamentId });
  if (tournamentTableId) {
    params.set("tt", tournamentTableId);
  }
  return `/tracker/hand-input?${params.toString()}`;
}

export function resolveTrackerHandInputRouteV2(
  search: URLSearchParams | string,
  tables: readonly TrackerTableSummaryV2[],
): TrackerHandInputRouteV2 {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const canonicalTournamentId = params.get("t")?.trim() ?? "";
  const legacyTournamentId = params.get("tournament")?.trim() ?? "";
  const tournamentId = canonicalTournamentId || legacyTournamentId;

  if (!tournamentId) {
    return { kind: "error", error: "missing_tournament" };
  }

  const tournamentTables = tables.filter(
    (table) => table.tournament_id === tournamentId,
  );
  const canonicalTableId = params.get("tt")?.trim() ?? "";
  const legacyTableId =
    params.get("table")?.trim() || params.get("tableId")?.trim() || "";

  if (
    canonicalTableId &&
    legacyTableId &&
    canonicalTableId !== legacyTableId
  ) {
    return { kind: "error", error: "ambiguous_table_identity" };
  }

  if (canonicalTableId) {
    const match = tournamentTables.find(
      (table) => table.tournament_table_id === canonicalTableId,
    );
    if (!match) {
      return { kind: "error", error: "table_not_found" };
    }
    const canonicalHref = buildTrackerHandInputHrefV2(
      tournamentId,
      match.tournament_table_id,
    );
    return {
      kind: "table",
      tournament_id: tournamentId,
      tournament_table_id: match.tournament_table_id,
      canonical_href: canonicalHref,
      needs_replace:
        !canonicalTournamentId ||
        params.toString() !== canonicalHref.split("?")[1],
    };
  }

  if (legacyTableId) {
    const matches = tournamentTables.filter(
      (table) =>
        table.tournament_table_id === legacyTableId ||
        table.physical_table_id === legacyTableId,
    );
    if (matches.length === 0) {
      return { kind: "error", error: "table_not_found" };
    }
    if (matches.length > 1) {
      return { kind: "error", error: "ambiguous_table_identity" };
    }
    return {
      kind: "table",
      tournament_id: tournamentId,
      tournament_table_id: matches[0].tournament_table_id,
      canonical_href: buildTrackerHandInputHrefV2(
        tournamentId,
        matches[0].tournament_table_id,
      ),
      needs_replace: true,
    };
  }

  const canonicalHref = buildTrackerHandInputHrefV2(tournamentId);
  return {
    kind: "launcher",
    tournament_id: tournamentId,
    canonical_href: canonicalHref,
    needs_replace:
      !canonicalTournamentId ||
      params.toString() !== canonicalHref.split("?")[1],
  };
}
