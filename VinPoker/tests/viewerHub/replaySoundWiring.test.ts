import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createReplayActionFxScheduler } from "@/lib/tracker-poker/replayFx";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/TournamentLiveView.tsx"),
  "utf8",
);

describe("viewer replay sound wiring", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a delayed action alive across unrelated playback-state rerenders", () => {
    vi.useFakeTimers();
    const scheduler = createReplayActionFxScheduler();
    const play = vi.fn();
    const playbackState = { muted: false, speed: 1 };

    scheduler.schedule("hand-1:frame-4", 500, () => play({ ...playbackState }));
    playbackState.muted = true;
    playbackState.speed = 4;
    vi.advanceTimersByTime(500);

    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith({ muted: true, speed: 4 });
  });

  it("cancels the stale action callback when the replay frame changes", () => {
    vi.useFakeTimers();
    const scheduler = createReplayActionFxScheduler();
    const stale = vi.fn();
    const current = vi.fn();

    scheduler.schedule("hand-1:frame-4", 500, stale);
    scheduler.schedule("hand-1:frame-5", 300, current);
    vi.advanceTimersByTime(500);

    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("uses the same liveTableFx gate for payout animation and payout sound", () => {
    const payoutSoundEffect = source.slice(
      source.indexOf("// The HUD owns the verified payout cadence."),
      source.indexOf("const replayFocusPhase"),
    );
    expect(payoutSoundEffect).toContain("!FEATURES.liveTableFx");
    expect(payoutSoundEffect).not.toContain("!FEATURES.liveTableMotionV2");
    expect(source).toContain("replayActionFxSchedulerRef.current?.cancel()");
  });
});
