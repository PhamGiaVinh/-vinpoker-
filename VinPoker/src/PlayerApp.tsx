import { Suspense, lazy } from "react";
import App from "@/App";
import { isTrackerVoiceUatRoute } from "@/lib/trackerVoice/previewRoute";

// The protected Voice UAT is deliberately fixture-backed and does not need a
// Supabase client. Keep the client in a lazy shell so its Preview can run with
// the narrowly scoped UAT variables instead of production app credentials.
const AuthenticatedPlayerApp = lazy(() => import("./AuthenticatedPlayerApp"));

const trackerVoiceUatEnabled = import.meta.env.VITE_TRACKER_VOICE_UAT_ENABLED === "true";
const isTrackerVoiceUatPreview = isTrackerVoiceUatRoute(window.location.pathname, trackerVoiceUatEnabled);

export default function PlayerApp() {
  if (isTrackerVoiceUatPreview) return <App />;

  return (
    <Suspense fallback={null}>
      <AuthenticatedPlayerApp />
    </Suspense>
  );
}
