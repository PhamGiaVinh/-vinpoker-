import { describe, expect, it, vi } from "vitest";
import { PublicSnapshotCoordinator, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";

describe("PublicSnapshotCoordinator", () => {
  it("coalesces an event storm into one trailing refresh", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const coordinator = new PublicSnapshotCoordinator(refresh);
    coordinator.request();
    coordinator.request();
    coordinator.request();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await first;
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("does not replay queued refreshes after stop", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn(() => first);
    const coordinator = new PublicSnapshotCoordinator(refresh);
    coordinator.request();
    coordinator.request();
    coordinator.stop();
    release();
    await first;
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repeated invalidation hints independently of hint payloads", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const coordinator = new PublicSnapshotCoordinator(refresh, 1_000);
    coordinator.request();
    await Promise.resolve();
    coordinator.request();
    coordinator.request();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    coordinator.stop();
    vi.useRealTimers();
  });
});

describe("normalizeVisibleTableIds", () => {
  it("deduplicates and caps the public request at sixteen tables", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `table-${index}`);
    expect(normalizeVisibleTableIds([ids[0], ...ids, ""])).toEqual(ids.slice(0, 16));
  });
});
