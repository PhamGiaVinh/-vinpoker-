import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { isRemoteBuildNewer, useVersionCheck } from "./useVersionCheck";

describe("isRemoteBuildNewer", () => {
  it("flags a cached mobile bundle on its first check when the deployed build differs", () => {
    expect(isRemoteBuildNewer("old-build", "new-build")).toBe(true);
  });

  it("does not reload when the loaded bundle and deployed build match", () => {
    expect(isRemoteBuildNewer("current-build", "current-build")).toBe(false);
  });

  it("fails closed when either version marker is unavailable", () => {
    expect(isRemoteBuildNewer(null, "current-build")).toBe(false);
    expect(isRemoteBuildNewer("current-build", null)).toBe(false);
  });
});

describe("useVersionCheck deployment markers", () => {
  const build = (version = "build-a") => ({ ok: true, json: async () => ({ version }) });
  const assets = (name = "a") => ({ ok: true, text: async () => `<script src="/assets/player-${name}.js"></script>` });
  const unavailable = () => ({ ok: false });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("location", new URL("https://vinpoker.vercel.app/floor"));
    vi.stubGlobal("__APP_VERSION__", "build-a");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function tick() {
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  }

  it("does not mistake a temporary marker failure and recovery for a deployment", async () => {
    fetchMock.mockResolvedValueOnce(build()).mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(assets()).mockResolvedValueOnce(build());
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    await tick();
    expect(notify).not.toHaveBeenCalled();
  });

  it("still detects changed fallback assets", async () => {
    fetchMock.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(assets())
      .mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(assets("b"));
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("detects an already stale bundle on the first probe", async () => {
    fetchMock.mockResolvedValue(build("build-b"));
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("detects a newer build after starting on fallback assets", async () => {
    fetchMock.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(assets())
      .mockResolvedValueOnce(build("build-b"));
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not notify after unmount while a request is pending", async () => {
    let resolve!: (response: ReturnType<typeof build>) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const notify = vi.fn();
    const view = renderHook(() => useVersionCheck(notify, 1000));
    view.unmount();
    await act(async () => { resolve(build("build-b")); });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not overlap timer and focus probes and notifies only once", async () => {
    let resolve!: (response: ReturnType<typeof build>) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValue(build("build-b"));
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(build()); });
    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("accepts the current build after starting on unchanged fallback assets", async () => {
    fetchMock.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(assets())
      .mockResolvedValue(build());
    const notify = vi.fn();
    renderHook(() => useVersionCheck(notify, 1000));
    await tick();
    await tick();
    expect(notify).not.toHaveBeenCalled();
  });
});
