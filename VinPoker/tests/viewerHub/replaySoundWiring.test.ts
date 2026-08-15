import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/TournamentLiveView.tsx"),
  "utf8",
);

describe("viewer replay sound wiring", () => {
  it("keeps a delayed action alive when mute or replay speed changes", () => {
    expect(source).toContain("const replayFxPlaybackStateRef = useRef({ soundMuted, spectator, replayMotionSpeed });");
    expect(source).toContain("replayActionSoundDelayMs(fx.deal, replayFxPlaybackStateRef.current.replayMotionSpeed)");
    expect(source).toContain("}, [replayFrame, replayFrameSource, mode]);");
  });

  it("uses the same liveTableFx gate for payout animation and payout sound", () => {
    const payoutSoundEffect = source.slice(
      source.indexOf("// The HUD owns the verified payout cadence."),
      source.indexOf("const replayFocusPhase"),
    );
    expect(payoutSoundEffect).toContain("!FEATURES.liveTableFx");
    expect(payoutSoundEffect).not.toContain("!FEATURES.liveTableMotionV2");
  });
});
