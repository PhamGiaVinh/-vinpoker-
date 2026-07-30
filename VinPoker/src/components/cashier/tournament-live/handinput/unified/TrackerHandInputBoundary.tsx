import { FEATURES } from "@/lib/featureFlags";
import { HandInputConsole } from "../HandInputConsole";
import { OpenHandInputConsoleButton } from "../OpenHandInputConsoleButton";
import { TrackerUnifiedOpsFixtureShell } from "./TrackerUnifiedOpsFixtureShell";

export function TrackerHandInputBoundary({
  tournamentId,
}: {
  tournamentId: string;
}) {
  if (FEATURES.trackerUnifiedOpsFlow) {
    return (
      <TrackerUnifiedOpsFixtureShell
        tournamentId={tournamentId}
        embedded
        presentation="embedded_handoff"
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
