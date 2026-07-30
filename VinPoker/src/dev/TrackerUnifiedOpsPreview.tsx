import { useSearchParams } from "react-router-dom";
import { TrackerUnifiedOpsFixtureShell } from "@/components/cashier/tournament-live/handinput/unified/TrackerUnifiedOpsFixtureShell";
import {
  TRACKER_UNIFIED_FIXTURE_IDS,
} from "@/lib/tracker-unified-ops/fixtures";
import type { TrackerOpsRole } from "@/lib/tracker-unified-ops/contracts";

type PreviewView = "launcher" | "ready" | "active" | "blocked";

const tableByView: Record<Exclude<PreviewView, "launcher">, string> = {
  ready: TRACKER_UNIFIED_FIXTURE_IDS.readyTournamentTable,
  active: TRACKER_UNIFIED_FIXTURE_IDS.activeTournamentTable,
  blocked: TRACKER_UNIFIED_FIXTURE_IDS.blockedTournamentTable,
};

function parseRole(value: string | null): TrackerOpsRole {
  if (
    value === "owner" ||
    value === "floor" ||
    value === "chipmaster" ||
    value === "tracker"
  ) {
    return value;
  }
  return "tracker";
}

function parseView(value: string | null): PreviewView {
  if (value === "ready" || value === "active" || value === "blocked") {
    return value;
  }
  return "launcher";
}

export default function TrackerUnifiedOpsPreview() {
  const [searchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const role = parseRole(searchParams.get("role"));

  return (
    <TrackerUnifiedOpsFixtureShell
      tournamentId={TRACKER_UNIFIED_FIXTURE_IDS.tournament}
      tournamentTableId={view === "launcher" ? null : tableByView[view]}
      role={role}
    />
  );
}
