// C4 (trackerActionSounds) — operator mute toggle for the tracker action sounds.
// Renders nothing when the flag is off (console header byte-identical to today).
// Persists to the SAME localStorage key as the /live viewer's toggle
// (`tracker_sound_muted`), so operator + viewer tabs in one browser share the mute;
// each tab reads it at mount (no cross-tab live sync — deliberate, view-local).
import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { isTrackerSoundMuted, setTrackerSoundMuted } from "@/lib/trackerSound";

export function TrackerSoundToggle() {
  const [muted, setMuted] = useState(isTrackerSoundMuted);
  if (!FEATURES.trackerActionSounds) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setTrackerSoundMuted(next);
        setMuted(next);
      }}
      title={muted ? "Bật âm thanh thao tác" : "Tắt âm thanh thao tác"}
      aria-label={muted ? "Bật âm thanh thao tác" : "Tắt âm thanh thao tác"}
      className={`inline-flex items-center rounded-lg border border-border/60 bg-card px-2.5 py-1.5 ${
        muted ? "text-muted-foreground" : "text-foreground"
      } hover:text-foreground`}
    >
      {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    </button>
  );
}
