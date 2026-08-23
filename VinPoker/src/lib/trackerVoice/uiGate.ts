import type { TrackerVoiceRuntimeContext } from "./types";

export function isTrackerVoiceUiEnabled(runtime: TrackerVoiceRuntimeContext | null): boolean {
  return runtime?.ok === true
    && runtime.read_only === false
    && runtime.config.enabled === true;
}
