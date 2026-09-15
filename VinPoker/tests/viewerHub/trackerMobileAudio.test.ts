import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function audioBrowser() {
  const sources: { buffer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; playbackRate: { value: number }; onended?: () => void }[] = [];
  const decoded = { duration: 0.6, decoded: true };
  const ctx = {
    state: "suspended", sampleRate: 44100, destination: {}, currentTime: 0,
    resume: vi.fn(async () => { ctx.state = "running"; }),
    createBuffer: vi.fn(() => ({ duration: 0 })),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as unknown, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), playbackRate: { value: 1 } };
      sources.push(source); return source;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
    decodeAudioData: vi.fn(async () => decoded),
  };
  const ctor = vi.fn(function () { return ctx; });
  const htmlAudio = vi.fn();
  vi.stubGlobal("AudioContext", ctor);
  vi.stubGlobal("Audio", htmlAudio);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  return { ctx, ctor, htmlAudio, sources, played: () => sources.filter(source => source.buffer === decoded && source.start.mock.calls.length > 0) };
}

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("mobile Tracker audio context", () => {
  it("unlocks synchronously and plays later street samples on the same context, without new HTMLAudio", async () => {
    const browser = audioBrowser();
    const sound = await import("@/lib/pokerLiveSound");
    sound.markPokerSoundGesture("tracker");
    expect(browser.ctx.resume).toHaveBeenCalledTimes(1);
    expect(browser.sources[0].start).toHaveBeenCalled();
    await flush();
    for (const kind of ["deal_flop", "deal_turn", "deal_river", "showdown", "hand_ranking", "pot_award"] as const) {
      sound.playPokerLiveSound(kind, { profile: "tracker", bypassStoredMute: true });
    }
    await flush();
    expect(browser.played()).toHaveLength(6);
    expect(browser.ctor).toHaveBeenCalledTimes(1);
    expect(browser.htmlAudio).not.toHaveBeenCalled();
    sound.stopTrackerPokerSounds();
    expect(browser.played().every(source => source.stop.mock.calls.length === 1)).toBe(true);
    browser.ctx.state = "suspended";
    sound.markPokerSoundGesture("tracker");
    expect(browser.ctx.resume).toHaveBeenCalledTimes(2);
    expect(browser.ctor).toHaveBeenCalledTimes(1);
  });

  it("drops a pending decode when the hand changes or mute cancels audio", async () => {
    const browser = audioBrowser();
    let finish!: (value: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    const sound = await import("@/lib/pokerLiveSound");
    sound.markPokerSoundGesture();
    sound.playPokerLiveSound("pot_award", { profile: "tracker", bypassStoredMute: true });
    sound.stopTrackerPokerSounds();
    finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await flush();
    expect(browser.played()).toHaveLength(0);
  });

  it("invalidates a slow previous-street download without stopping a sample already playing", async () => {
    const browser = audioBrowser();
    const sound = await import("@/lib/pokerLiveSound");
    sound.markPokerSoundGesture();
    sound.playPokerLiveSound("showdown", { profile: "tracker", bypassStoredMute: true });
    await flush();
    expect(browser.played()).toHaveLength(1);
    let finish!: (value: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    sound.playPokerLiveSound("deal_flop", { profile: "tracker", bypassStoredMute: true });
    sound.cancelPendingTrackerPokerSounds();
    finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await flush();
    expect(browser.played()).toHaveLength(1);
    expect(browser.played()[0].stop).not.toHaveBeenCalled();
  });

  it("stops active samples on backgrounding and refuses new cues while hidden", async () => {
    const browser = audioBrowser();
    const sound = await import("@/lib/pokerLiveSound");
    sound.markPokerSoundGesture("tracker");
    await flush();
    sound.playPokerLiveSound("pot_award", { profile: "tracker", bypassStoredMute: true });
    await flush();
    expect(browser.played()).toHaveLength(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(browser.played()[0].stop).toHaveBeenCalledTimes(1);
    sound.playPokerLiveSound("deal_turn", { profile: "tracker", bypassStoredMute: true });
    await flush();
    expect(browser.played()).toHaveLength(1);
  });
});
