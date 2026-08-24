import { useEffect, useState } from "react";

import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { loadTrackerVoiceRuntimeContext, type TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";
import { isTrackerVoiceUiEnabled } from "@/lib/trackerVoice/uiGate";

import { TrackerVoicePanel } from "./TrackerVoicePanel";

/**
 * The build flag only enables this read-only server gate. The server remains
 * authoritative for the exact table, active dealer assignment, and Voice mode.
 */
export function TrackerVoicePanelGate({ hook }: { hook: StandaloneHandInput }) {
  const [runtime, setRuntime] = useState<TrackerVoiceRuntimeContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!hook.tournamentTableId) {
      setRuntime(null);
      return () => {
        cancelled = true;
      };
    }

    void loadTrackerVoiceRuntimeContext(hook.tournamentId, hook.tournamentTableId)
      .then((nextRuntime) => {
        if (!cancelled) setRuntime(nextRuntime);
      })
      .catch(() => {
        // A missing assignment or disabled config must keep the Voice surface hidden.
        if (!cancelled) setRuntime(null);
      });

    return () => {
      cancelled = true;
    };
  }, [hook.tournamentId, hook.tournamentTableId]);

  return isTrackerVoiceUiEnabled(runtime) ? <TrackerVoicePanel hook={hook} /> : null;
}
