import { describe, it, expect } from "vitest";
import { getSwingTableStatus } from "../swingTableStatus";

const base = { hasAssignment: true, isOt: false, isPastDue: false, remainingMinutes: 20, warnAtMinutes: 5 };

describe("getSwingTableStatus", () => {
  it("no assignment → empty", () => {
    const s = getSwingTableStatus({ ...base, hasAssignment: false });
    expect(s.kind).toBe("empty");
    expect(s.tone).toBe("muted");
  });

  it("overtime → overdue (destructive)", () => {
    const s = getSwingTableStatus({ ...base, isOt: true });
    expect(s.kind).toBe("overdue");
    expect(s.tone).toBe("destructive");
  });

  it("past due → overdue", () => {
    const s = getSwingTableStatus({ ...base, isPastDue: true, remainingMinutes: -2 });
    expect(s.kind).toBe("overdue");
  });

  it("within warn window → due_soon (warning)", () => {
    const s = getSwingTableStatus({ ...base, remainingMinutes: 4, warnAtMinutes: 5 });
    expect(s.kind).toBe("due_soon");
    expect(s.tone).toBe("warning");
  });

  it("exactly at warn boundary → due_soon", () => {
    const s = getSwingTableStatus({ ...base, remainingMinutes: 5, warnAtMinutes: 5 });
    expect(s.kind).toBe("due_soon");
  });

  it("comfortably ahead → ok (primary)", () => {
    const s = getSwingTableStatus({ ...base, remainingMinutes: 20, warnAtMinutes: 5 });
    expect(s.kind).toBe("ok");
    expect(s.tone).toBe("primary");
  });

  it("overdue takes precedence over due_soon window", () => {
    const s = getSwingTableStatus({ ...base, isPastDue: true, remainingMinutes: 3, warnAtMinutes: 5 });
    expect(s.kind).toBe("overdue");
  });

  it("null remaining with assignment, not overdue → ok", () => {
    const s = getSwingTableStatus({ ...base, remainingMinutes: null });
    expect(s.kind).toBe("ok");
  });
});
