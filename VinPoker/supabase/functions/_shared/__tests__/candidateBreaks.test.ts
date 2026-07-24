import { assertEquals } from "jsr:@std/assert@1";
import {
  CANDIDATE_BREAK_QUERY_CHUNK_SIZE,
  chunkIds,
  loadCandidateActiveBreaks,
} from "../candidateBreaks.ts";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `attendance-${String(index).padStart(3, "0")}`);
}

Deno.test("candidate break batches dedupe and split at the fixed boundary", () => {
  assertEquals(CANDIDATE_BREAK_QUERY_CHUNK_SIZE, 50);
  assertEquals(chunkIds(["b", "a", "b", "", "c"]), [["a", "b", "c"]]);
  assertEquals(chunkIds(ids(1)).map((chunk) => chunk.length), [1]);
  assertEquals(chunkIds(ids(10)).map((chunk) => chunk.length), [10]);
  assertEquals(chunkIds(ids(25)).map((chunk) => chunk.length), [25]);
  assertEquals(chunkIds(ids(50)).map((chunk) => chunk.length), [50]);
  assertEquals(chunkIds(ids(100)).map((chunk) => chunk.length), [50, 50]);
  assertEquals(chunkIds(ids(200)).map((chunk) => chunk.length), [50, 50, 50, 50]);
});

Deno.test("candidate break loader handles one ID, hundreds, and a legacy assignment-linked break", async () => {
  const calls: { kind: string; ids: string[] }[] = [];
  const result = await loadCandidateActiveBreaks(
    [...ids(233), "attendance-000"],
    {
      loadAttendanceLinked: async (chunk) => {
        calls.push({ kind: "attendance", ids: chunk });
        return {
          data: chunk[0] ? [{ attendance_id: chunk[0], break_start: "2026-07-24T10:00:00.000Z" }] : [],
          error: null,
        };
      },
      loadLegacyAssignmentLinked: async (chunk) => {
        calls.push({ kind: "legacy", ids: chunk });
        return chunk.includes("attendance-100")
          ? {
            data: [{
              assignment_id: "legacy-assignment",
              break_start: "2026-07-24T09:00:00.000Z",
              dealer_assignments: { attendance_id: "attendance-100" },
            }],
            error: null,
          }
          : { data: [], error: null };
      },
    },
  );

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(calls.filter((call) => call.kind === "attendance").map((call) => call.ids.length), [50, 50, 50, 50, 33]);
  assertEquals(calls.filter((call) => call.kind === "legacy").map((call) => call.ids.length), [50, 50, 50, 50, 33]);
  assertEquals(result.activeBreakByAttendanceId.get("attendance-000"), "2026-07-24T10:00:00.000Z");
  assertEquals(result.activeBreakByAttendanceId.get("attendance-100"), "2026-07-24T09:00:00.000Z");
});

Deno.test("a failed legacy chunk fails the whole candidate snapshot without returning partial breaks", async () => {
  const calls: string[] = [];
  const result = await loadCandidateActiveBreaks(ids(100), {
    loadAttendanceLinked: async (chunk) => {
      calls.push(`attendance:${chunk.length}`);
      return { data: [{ attendance_id: chunk[0], break_start: "2026-07-24T10:00:00.000Z" }], error: null };
    },
    loadLegacyAssignmentLinked: async (chunk) => {
      calls.push(`legacy:${chunk.length}`);
      return chunk[0] === "attendance-050"
        ? { data: null, error: { code: "XX000", message: "private failure" } }
        : { data: [], error: null };
    },
  }, (() => 100) as () => number);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.failure.stage, "assignment_breaks");
  assertEquals(result.failure.inputCount, 50);
  assertEquals(calls, ["attendance:50", "legacy:50", "attendance:50", "legacy:50"]);
});
