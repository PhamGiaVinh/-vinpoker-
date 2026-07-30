import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";
import { TRACKER_TABLE_LIST_FIXTURE } from "@/lib/tracker-unified-ops/fixtures";
import {
  buildTrackerHandInputHrefV2,
  resolveTrackerHandInputRouteV2,
} from "@/lib/tracker-unified-ops/navigation";

const tournamentId = TRACKER_TABLE_LIST_FIXTURE.tournament_id;
const tables = TRACKER_TABLE_LIST_FIXTURE.tables;

describe("Tracker Unified Ops V2 navigation", () => {
  it("keeps the mergeable source flag OFF", () => {
    expect(FEATURES.trackerUnifiedOpsFlow).toBe(false);
  });

  it("builds launcher and exact-table canonical URLs", () => {
    expect(buildTrackerHandInputHrefV2(tournamentId)).toBe(
      `/tracker/hand-input?t=${tournamentId}`,
    );
    expect(
      buildTrackerHandInputHrefV2(
        tournamentId,
        tables[0].tournament_table_id,
      ),
    ).toBe(
      `/tracker/hand-input?t=${tournamentId}&tt=${tables[0].tournament_table_id}`,
    );
  });

  it("accepts a canonical tournament-table id without replacement", () => {
    expect(
      resolveTrackerHandInputRouteV2(
        `?t=${tournamentId}&tt=${tables[0].tournament_table_id}`,
        tables,
      ),
    ).toEqual({
      kind: "table",
      tournament_id: tournamentId,
      tournament_table_id: tables[0].tournament_table_id,
      canonical_href: `/tracker/hand-input?t=${tournamentId}&tt=${tables[0].tournament_table_id}`,
      needs_replace: false,
    });
  });

  it("canonicalizes a unique legacy physical table id", () => {
    expect(
      resolveTrackerHandInputRouteV2(
        `?tournament=${tournamentId}&table=${tables[0].physical_table_id}`,
        tables,
      ),
    ).toMatchObject({
      kind: "table",
      tournament_id: tournamentId,
      tournament_table_id: tables[0].tournament_table_id,
      needs_replace: true,
    });
  });

  it("fails closed for zero or conflicting matches", () => {
    expect(
      resolveTrackerHandInputRouteV2(
        `?t=${tournamentId}&tt=ffffffff-ffff-4fff-8fff-ffffffffffff`,
        tables,
      ),
    ).toEqual({ kind: "error", error: "table_not_found" });
    expect(
      resolveTrackerHandInputRouteV2(
        `?t=${tournamentId}&tt=${tables[0].tournament_table_id}&table=${tables[1].physical_table_id}`,
        tables,
      ),
    ).toEqual({ kind: "error", error: "ambiguous_table_identity" });
  });

  it("fails closed when one legacy id maps to multiple tables", () => {
    const duplicatePhysical = [
      tables[0],
      {
        ...tables[1],
        physical_table_id: tables[0].physical_table_id,
      },
    ];
    expect(
      resolveTrackerHandInputRouteV2(
        `?tournament=${tournamentId}&table=${tables[0].physical_table_id}`,
        duplicatePhysical,
      ),
    ).toEqual({ kind: "error", error: "ambiguous_table_identity" });
  });

  it("requires a tournament id", () => {
    expect(resolveTrackerHandInputRouteV2("", tables)).toEqual({
      kind: "error",
      error: "missing_tournament",
    });
  });
});
