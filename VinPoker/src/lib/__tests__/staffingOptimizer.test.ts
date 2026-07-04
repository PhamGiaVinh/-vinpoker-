import { describe, expect, it } from "vitest";
import {
  computeStaffingTarget,
  computeStaffing,
  rankReleaseCandidates,
  DEFAULT_SWING_DURATION_MIN,
  DEFAULT_MIN_REST_MIN,
  type ReleaseCandidateInput,
} from "@/lib/staffingOptimizer";

describe("computeStaffingTarget (nhịp xoay ca)", () => {
  it("10 tables, deal 40 / rest 13 → required 14 (buffer 4)", () => {
    const t = computeStaffingTarget({ activeTables: 10, swingDurationMin: 40, minRestMin: 13 });
    expect(t.required).toBe(14); // ceil(10 * 53/40) = ceil(13.25)
    expect(t.buffer).toBe(4);
  });

  it("0 tables → 0 required, 0 buffer", () => {
    expect(computeStaffingTarget({ activeTables: 0, swingDurationMin: 40, minRestMin: 13 })).toEqual({
      required: 0,
      buffer: 0,
    });
  });

  it("falls back to defaults when config missing", () => {
    const t = computeStaffingTarget({ activeTables: 8 });
    const expected = Math.ceil((8 * (DEFAULT_SWING_DURATION_MIN + DEFAULT_MIN_REST_MIN)) / DEFAULT_SWING_DURATION_MIN);
    expect(t.required).toBe(expected); // ceil(8*53/40)=ceil(10.6)=11
    expect(t.required).toBe(11);
  });

  it("guards zero/negative swing duration with the default", () => {
    const t = computeStaffingTarget({ activeTables: 5, swingDurationMin: 0, minRestMin: 13 });
    expect(t.required).toBe(computeStaffingTarget({ activeTables: 5, minRestMin: 13 }).required);
  });
});

describe("computeStaffing (thừa/thiếu)", () => {
  it("over: 8 tables (need 11) + 14 present → surplus 3", () => {
    const r = computeStaffing({ activeTables: 8, present: 14, swingDurationMin: 40, minRestMin: 13 });
    expect(r.required).toBe(11);
    expect(r.surplus).toBe(3);
    expect(r.deficit).toBe(0);
    expect(r.status).toBe("over");
  });

  it("short: 12 tables (need 16) + 13 present → deficit 3", () => {
    const r = computeStaffing({ activeTables: 12, present: 13, swingDurationMin: 40, minRestMin: 13 });
    expect(r.required).toBe(16); // ceil(12*53/40)=ceil(15.9)
    expect(r.deficit).toBe(3);
    expect(r.surplus).toBe(0);
    expect(r.status).toBe("short");
  });

  it("balanced: present == required", () => {
    const r = computeStaffing({ activeTables: 10, present: 14, swingDurationMin: 40, minRestMin: 13 });
    expect(r.status).toBe("balanced");
    expect(r.deficit).toBe(0);
    expect(r.surplus).toBe(0);
  });
});

describe("rankReleaseCandidates", () => {
  const base: ReleaseCandidateInput[] = [
    { attendanceId: "a1", name: "assigned-high", state: "assigned", tier: "C", workedMin: 200 },
    { attendanceId: "a2", name: "avail-120", state: "available", tier: "B", workedMin: 120 },
    { attendanceId: "a3", name: "break-104", state: "on_break", tier: "A", workedMin: 104 },
    { attendanceId: "a4", name: "avail-96-C", state: "available", tier: "C", workedMin: 96 },
    { attendanceId: "a5", name: "preassigned", state: "pre_assigned", tier: "B", workedMin: 150 },
  ];

  it("excludes assigned + pre_assigned (they cover / are about to cover a table)", () => {
    const out = rankReleaseCandidates(base, 5);
    const ids = out.map((c) => c.attendanceId);
    expect(ids).not.toContain("a1"); // assigned
    expect(ids).not.toContain("a5"); // pre_assigned
    expect(ids).toEqual(["a2", "a3", "a4"]); // by workedMin desc
  });

  it("respects the limit (= surplus)", () => {
    expect(rankReleaseCandidates(base, 2).map((c) => c.attendanceId)).toEqual(["a2", "a3"]);
  });

  it("tie on workedMin → lower tier first", () => {
    const tied: ReleaseCandidateInput[] = [
      { attendanceId: "x", name: "A", state: "available", tier: "A", workedMin: 100 },
      { attendanceId: "y", name: "C", state: "available", tier: "C", workedMin: 100 },
    ];
    expect(rankReleaseCandidates(tied, 2).map((c) => c.attendanceId)).toEqual(["y", "x"]);
  });

  it("attaches a Vietnamese state label", () => {
    const out = rankReleaseCandidates(base, 1);
    expect(out[0].stateLabel).toBe("đang rảnh");
  });

  it("limit 0 → empty", () => {
    expect(rankReleaseCandidates(base, 0)).toEqual([]);
  });
});
