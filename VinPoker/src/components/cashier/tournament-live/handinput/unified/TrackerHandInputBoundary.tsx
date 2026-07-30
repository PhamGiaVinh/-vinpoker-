import { FEATURES } from "@/lib/featureFlags";
import type { TrackerOpsRole } from "@/lib/tracker-unified-ops/contracts";
import { HandInputConsole } from "../HandInputConsole";
import { OpenHandInputConsoleButton } from "../OpenHandInputConsoleButton";
import { TrackerUnifiedOpsFixtureShell } from "./TrackerUnifiedOpsFixtureShell";

export function TrackerHandInputBoundary({
  tournamentId,
  role = "tracker",
}: {
  tournamentId: string;
  role?: TrackerOpsRole;
}) {
  if (FEATURES.trackerUnifiedOpsFlow) {
    return (
      <TrackerUnifiedOpsFixtureShell
        tournamentId={tournamentId}
        role={role}
        embedded
      />
    );
  }

  return (
    <>
      <OpenHandInputConsoleButton tournamentId={tournamentId} />
      <HandInputConsole tournamentId={tournamentId} />
    </>
  );
}
