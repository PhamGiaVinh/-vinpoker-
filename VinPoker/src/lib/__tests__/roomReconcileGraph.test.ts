import { describe, it, expect } from "vitest";
import { classifyRoomReconcile, type ReconcileGraphInput } from "../roomReconcileGraph";

// Fixed ids for readability.
const t1 = "t1", t2 = "t2", t3 = "t3", tX = "tX";
const dA = "dA", dB = "dB", dC = "dC";

function run(input: ReconcileGraphInput) {
  return classifyRoomReconcile(input);
}

describe("classifyRoomReconcile", () => {
  it("one-sided assign: empty table, pool dealer in no active table", () => {
    const r = run({
      rows: [{ tableId: t1, recordedAttendanceId: null, actualAttendanceId: dA }],
      attendanceCurrentTable: {}, // dA sits nowhere
    });
    expect(r.components).toHaveLength(1);
    expect(r.components[0].kind).toBe("one_sided_assign");
    expect(r.components[0].tableIds).toEqual([t1]);
    expect(r.displaced).toEqual([]);
    expect(r.flags.duplicate_actual).toEqual([]);
    expect(r.flags.actual_active_at_unselected_table).toEqual([]);
  });

  it("one-sided release: recorded dealer leaves, table marked empty → displaced", () => {
    const r = run({
      rows: [{ tableId: t1, recordedAttendanceId: dB, actualAttendanceId: null }],
      attendanceCurrentTable: { [dB]: t1 },
    });
    expect(r.components[0].kind).toBe("one_sided_release");
    expect(r.displaced).toEqual([{ attendanceId: dB, fromTableId: t1 }]);
  });

  it("already-correct no-op", () => {
    const r = run({
      rows: [{ tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dA }],
      attendanceCurrentTable: { [dA]: t1 },
    });
    expect(r.components).toHaveLength(1);
    expect(r.components[0].kind).toBe("already_correct");
    expect(r.displaced).toEqual([]);
    expect(r.flags.duplicate_actual).toEqual([]);
  });

  it("2-table swap: A↔B", () => {
    const r = run({
      rows: [
        { tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dB },
        { tableId: t2, recordedAttendanceId: dB, actualAttendanceId: dA },
      ],
      attendanceCurrentTable: { [dA]: t1, [dB]: t2 },
    });
    expect(r.components).toHaveLength(1);
    expect(r.components[0].kind).toBe("swap");
    expect(r.components[0].tableIds.sort()).toEqual([t1, t2]);
    expect(r.displaced).toEqual([]);
  });

  it("3-table cycle: A→t2, B→t3, C→t1 (each dealer moves one table over)", () => {
    // t1 actual = dC (dC currently at t3); t2 actual = dA (at t1); t3 actual = dB (at t2)
    const r = run({
      rows: [
        { tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dC },
        { tableId: t2, recordedAttendanceId: dB, actualAttendanceId: dA },
        { tableId: t3, recordedAttendanceId: dC, actualAttendanceId: dB },
      ],
      attendanceCurrentTable: { [dA]: t1, [dB]: t2, [dC]: t3 },
    });
    expect(r.components).toHaveLength(1);
    expect(r.components[0].kind).toBe("cycle");
    expect(r.components[0].tableIds.sort()).toEqual([t1, t2, t3]);
    expect(r.displaced).toEqual([]);
  });

  it("mixed: 2-swap + a separate one-sided release with displaced dealer", () => {
    const r = run({
      rows: [
        { tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dB },
        { tableId: t2, recordedAttendanceId: dB, actualAttendanceId: dA },
        { tableId: t3, recordedAttendanceId: dC, actualAttendanceId: null },
      ],
      attendanceCurrentTable: { [dA]: t1, [dB]: t2, [dC]: t3 },
    });
    const kinds = r.components.map((c) => c.kind).sort();
    expect(kinds).toEqual(["one_sided_release", "swap"]);
    expect(r.displaced).toEqual([{ attendanceId: dC, fromTableId: t3 }]);
  });

  it("duplicate actual: same dealer chosen at two selected tables", () => {
    const r = run({
      rows: [
        { tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dC },
        { tableId: t2, recordedAttendanceId: dB, actualAttendanceId: dC },
      ],
      attendanceCurrentTable: { [dA]: t1, [dB]: t2, [dC]: tX },
    });
    expect(r.flags.duplicate_actual).toEqual([dC]);
  });

  it("actual active at unselected table", () => {
    const r = run({
      rows: [{ tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dB }],
      attendanceCurrentTable: { [dA]: t1, [dB]: tX }, // dB sits at unselected tX
    });
    expect(r.flags.actual_active_at_unselected_table).toEqual([
      { attendanceId: dB, currentTableId: tX, neededForTableId: t1 },
    ]);
    // dA recorded at t1, not re-seated anywhere → displaced
    expect(r.displaced).toEqual([{ attendanceId: dA, fromTableId: t1 }]);
  });

  it("displaced dealer appears exactly once per not-reseated recorded dealer", () => {
    // chain: t1 gets a pool dealer dC; dA (recorded t1) not re-seated → displaced once.
    const r = run({
      rows: [{ tableId: t1, recordedAttendanceId: dA, actualAttendanceId: dC }],
      attendanceCurrentTable: { [dA]: t1 }, // dC is pool
    });
    const occurrences = r.displaced.filter((d) => d.attendanceId === dA).length;
    expect(occurrences).toBe(1);
    expect(r.components[0].kind).toBe("one_sided_assign");
  });
});
