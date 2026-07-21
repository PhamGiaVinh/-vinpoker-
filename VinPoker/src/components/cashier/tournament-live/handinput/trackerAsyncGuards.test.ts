import { describe, expect, it } from "vitest";
import {
  buildNextHandNumberRequest,
  classifyActionWriteFailure,
  createActionWriteGuard,
  createTableLoadGuard,
  isConfirmedActionWrite,
} from "./trackerAsyncGuards";

describe("tracker async guards", () => {
  it("keeps only the latest table load eligible to commit and invalidates on unmount", () => {
    const guard = createTableLoadGuard();
    const tableA = guard.begin("table-a");
    const tableB = guard.begin("table-b");
    const committed: string[] = [];

    if (guard.isCurrent(tableB)) committed.push("players", "maxSeats", "buttonSeat", "handNumber", "orphanHand", "autoResumeArmed");
    if (guard.isCurrent(tableA)) committed.push("late-a");

    expect(committed).toEqual(["players", "maxSeats", "buttonSeat", "handNumber", "orphanHand", "autoResumeArmed"]);

    guard.dispose();
    expect(guard.isCurrent(tableB)).toBe(false);
  });

  it("builds a next-hand request from the explicit selected table, never a stale closure", () => {
    expect(buildNextHandNumberRequest("tournament-1", "table-b")).toEqual({
      p_tournament_id: "tournament-1",
      p_table_id: "table-b",
    });
  });

  it("permits only one action write and stale completion cannot unlock a newer scope", () => {
    const guard = createActionWriteGuard();
    let edgeInvocations = 0;
    const submit = (scope: string) => {
      const token = guard.begin(scope);
      if (!token) return null;
      edgeInvocations += 1;
      return token;
    };
    const first = submit("table-a:hand-1");

    expect(first).not.toBeNull();
    expect(submit("table-a:hand-1")).toBeNull();
    expect(submit("table-b:hand-2")).toBeNull();
    expect(edgeInvocations).toBe(1);

    guard.invalidate("table-a:hand-1");
    const second = submit("table-b:hand-2");
    expect(second).not.toBeNull();
    expect(guard.finish(first!)).toBe(false);
    expect(guard.isBusy()).toBe(true);
    expect(guard.finish(second!)).toBe(true);
    expect(guard.isBusy()).toBe(false);
  });

  it("commits one action, one order increment, and one stack delta after a single-flight success", () => {
    const guard = createActionWriteGuard();
    let actionCount = 0;
    let nextOrder = 1;
    let stack = 100;
    const submit = () => guard.begin("table-a:hand-1");
    const first = submit();
    const duplicate = submit();

    if (first && guard.finish(first)) {
      actionCount += 1;
      nextOrder += 1;
      stack -= 25;
    }

    expect(duplicate).toBeNull();
    expect({ actionCount, nextOrder, stack }).toEqual({ actionCount: 1, nextOrder: 2, stack: 75 });
  });

  it("releases a validation rejection without committing an optimistic action", () => {
    const guard = createActionWriteGuard();
    const attempt = guard.begin("table-a:hand-1");

    expect(classifyActionWriteFailure({ code: "OUT_OF_TURN", message: "out of turn" })).toBe("validation");
    expect(guard.finish(attempt!)).toBe(true);
    expect(guard.begin("table-a:hand-1")).not.toBeNull();
  });

  it.each([
    { message: "Edge Function returned a non-2xx status code" },
    { data: { error: "write failed" } },
    { data: { error: { unexpected: true } } },
  ])("fails closed for an ambiguous Edge rejection: %#", (failure) => {
    expect(classifyActionWriteFailure(failure)).toBe("uncertain");
  });

  it("accepts only the existing Edge success envelope and rejects malformed responses", () => {
    expect(isConfirmedActionWrite({ status: "success", data: null })).toBe(true);
    expect(isConfirmedActionWrite({ status: "success" })).toBe(false);
    expect(isConfirmedActionWrite({ ok: true })).toBe(false);
    expect(isConfirmedActionWrite("success")).toBe(false);
  });

  it("blocks further actions after an ambiguous outcome until an authoritative reload", () => {
    const guard = createActionWriteGuard();
    const attempt = guard.begin("table-a:hand-1");

    expect(attempt).not.toBeNull();
    expect(guard.markUncertain(attempt!)).toBe(true);
    expect(guard.isBlocked("table-a:hand-1")).toBe(true);
    expect(guard.begin("table-a:hand-1")).toBeNull();
  });
});
