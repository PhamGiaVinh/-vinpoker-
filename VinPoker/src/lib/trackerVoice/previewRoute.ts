const UAT_PATHS = new Set(["/__uat/tracker-voice", "/__dev/tracker-voice-v0", "/__dev/tracker-voice-uat"]);

export function isTrackerVoiceUatRoute(pathname: string, enabled: boolean): boolean {
  return enabled && UAT_PATHS.has(pathname);
}
