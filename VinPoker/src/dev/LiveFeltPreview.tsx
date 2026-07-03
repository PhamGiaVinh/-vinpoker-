// DEV-ONLY visual harness for the tracker LiveFelt. Gated to import.meta.env.DEV in
// App.tsx (route + lazy chunk tree-shaken from production). Reached only at
// /__dev/livefelt; not linked anywhere. Renders the REAL <LiveFelt> (and, in play
// mode, the REAL <ReplayScrubber>) from deterministic fixtures — no Supabase, no
// auth, no real tournament/player data.
//
// URL params:
//   fixture      = fold-walk | showdown | allin-sidepots   (default allin-sidepots)
//   seats        = 3 | 6 | 9                               (default 9)
//   step         = <frame index>                           (default: final frame)
//   play         = 0 | 1  (mount ReplayScrubber, auto-play) (default 0)
//   speed        = playback speed multiplier for play mode  (default 1)
//   orientation  = landscape | portrait                     (default landscape)
//   viewerLayout = 0 | 1                                    (default 1)
//   compact      = 0 | 1                                    (default 1)
//   tableFx      = 0 | 1                                    (default 1)
//   wrap         = plain | console | hub  (consumer sims)   (default plain)
//   width        = <px> fixed test-bed width                (default: viewport)
//
// The default param set (viewerLayout=1 compact=1 tableFx=1, landscape, 9 seats,
// allin-sidepots) reproduces the owner's problem configuration.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LiveFelt } from "@/components/cashier/tournament-live/LiveFelt";
import { ReplayScrubber } from "@/components/cashier/tournament-live/ReplayScrubber";
import { buildReplayFrames, detectBigBlind, type ReplayFrame } from "@/lib/tracker-poker/replayEngine";
import { buildFixtureHand, type LiveFeltFixtureName } from "./livefeltFixtures";

const FIXTURES: LiveFeltFixtureName[] = ["fold-walk", "showdown", "allin-sidepots"];

export default function LiveFeltPreview() {
  const [params] = useSearchParams();
  const fixtureParam = params.get("fixture") as LiveFeltFixtureName | null;
  const fixture: LiveFeltFixtureName = fixtureParam && FIXTURES.includes(fixtureParam) ? fixtureParam : "allin-sidepots";
  const seats = Math.max(3, Math.min(9, Number(params.get("seats")) || 9));
  const play = params.get("play") === "1";
  const orientation = params.get("orientation") === "portrait" ? "portrait" : "landscape";
  const viewerLayout = params.get("viewerLayout") !== "0";
  const compact = params.get("compact") !== "0";
  const tableFx = params.get("tableFx") !== "0";
  const wrap = params.get("wrap") ?? "plain";
  const widthPx = Number(params.get("width")) || 0;
  const speed = Number(params.get("speed")) || 1;

  const hand = useMemo(() => buildFixtureHand(fixture, seats), [fixture, seats]);
  // trackBets mirrors the real viewer: ReplayScrubber passes it when compact is on.
  const frames = useMemo(() => buildReplayFrames(hand, { trackBets: viewerLayout && compact }), [hand, viewerLayout, compact]);
  const stepParam = params.get("step");
  const step = stepParam == null ? frames.length - 1 : Math.max(0, Math.min(frames.length - 1, Number(stepParam) || 0));

  const [frame, setFrame] = useState<ReplayFrame>(frames[step]);
  useEffect(() => { if (!play) setFrame(frames[step]); }, [frames, step, play]);

  const bb = detectBigBlind(hand);
  const formatBB = (n: number): string | null => (bb > 0 ? `${(n / bb).toFixed(1).replace(/\.0$/, "")} BB` : null);
  const blinds = bb > 0 ? { sb: bb / 2, bb, ante: 0 } : null;

  const felt = (
    <LiveFelt
      seats={frame.seats}
      lastActorId={frame.lastActorId}
      displayCards={frame.displayCards}
      potSize={frame.potSize}
      potBreakdown={frame.potBreakdown}
      multiTableUnresolved={false}
      handNumber={hand.hand_number}
      latestAction={frame.latestAction}
      formatBB={formatBB}
      portrait={orientation === "portrait"}
      buttonSeat={hand.button_seat}
      viewerLayout={viewerLayout}
      compact={compact}
      tableFx={tableFx}
      blinds={blinds}
    />
  );

  // Consumer sims: plain full-width column (spectator page), the Standalone
  // hand-input console grid, and a viewer-hub FeaturedTableCard-like padded card.
  const wrapped =
    wrap === "console" ? (
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>{felt}</div>
        <div className="rounded-lg border border-border/40 bg-black/20 p-3 text-xs text-muted-foreground">console panel placeholder</div>
      </div>
    ) : wrap === "hub" ? (
      <div className="rounded-xl border border-border/40 bg-card/60 p-2 sm:p-3">{felt}</div>
    ) : (
      felt
    );

  return (
    <div data-dev-livefelt-preview className="min-h-screen bg-background p-3" style={widthPx > 0 ? { width: widthPx, marginInline: "auto" } : undefined}>
      <div className="mb-2 text-[10px] text-muted-foreground">
        /__dev/livefelt · {fixture} · seats={seats} · step={play ? "play" : step}/{frames.length - 1} · {orientation} · vL={viewerLayout ? 1 : 0} compact={compact ? 1 : 0} fx={tableFx ? 1 : 0} · wrap={wrap}
      </div>
      {wrapped}
      {play && (
        <div className="mt-3">
          <ReplayScrubber hand={hand} onFrame={setFrame} trackBets={viewerLayout && compact} />
          <AutoPlay speed={speed} />
        </div>
      )}
    </div>
  );
}

/** Play-mode helper: selects the requested speed (each speed is its own "N×" button)
 *  and presses Phát once on mount, so `play=1&speed=8` runs hands-free. */
function AutoPlay({ speed }: { speed: number }) {
  useEffect(() => {
    const root = document.querySelector("[data-dev-livefelt-preview]");
    if (!root) return;
    const buttons = [...root.querySelectorAll("button")];
    const speedBtn = buttons.find((b) => (b.textContent?.trim() ?? "") === `${speed}×`);
    speedBtn?.click();
    const playBtn = buttons.find((b) => b.getAttribute("title") === "Phát");
    playBtn?.click();
  }, [speed]);
  return null;
}
