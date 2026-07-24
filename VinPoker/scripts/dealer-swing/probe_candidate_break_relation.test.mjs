import assert from "node:assert/strict";
import test from "node:test";
import { probeCandidateBreakRelation } from "./probe_candidate_break_relation.mjs";

function adminResponse(response) {
  const calls = [];
  const builder = {
    select(value) { calls.push(["select", value]); return builder; },
    is(column, value) { calls.push(["is", column, value]); return builder; },
    async limit(value) { calls.push(["limit", value]); return response; },
  };
  return {
    calls,
    admin: { from(table) { calls.push(["from", table]); return builder; } },
  };
}

test("relation probe uses the exact zero-row runtime embedding shape", async () => {
  const fixture = adminResponse({ data: [], error: null, status: 200 });
  const result = await probeCandidateBreakRelation({ admin: fixture.admin });

  assert.deepEqual(result, {
    probe: "dealer_breaks_assignment_relation",
    status: 200,
    provider_code: null,
    relation_ready: true,
    rows_returned: 0,
  });
  assert.deepEqual(fixture.calls, [
    ["from", "dealer_breaks"],
    ["select", "assignment_id, break_start, dealer_assignments!inner(attendance_id)"],
    ["is", "break_end", null],
    ["is", "attendance_id", null],
    ["limit", 0],
  ]);
});

test("relation probe accepts a zero-row partial response", async () => {
  const fixture = adminResponse({ data: [], error: null, status: 206 });
  const result = await probeCandidateBreakRelation({ admin: fixture.admin });
  assert.equal(result.relation_ready, true);
  assert.equal(result.status, 206);
});

test("relation probe keeps PostgREST failure output sanitized", async () => {
  const rawUuid = "11111111-2222-3333-4444-555555555555";
  const fixture = adminResponse({
    data: null,
    error: {
      code: "PGRST200",
      message: `private URL https://example.test/${rawUuid}`,
      details: "private header",
    },
    status: 400,
  });
  const result = await probeCandidateBreakRelation({ admin: fixture.admin });
  const rendered = JSON.stringify(result);

  assert.deepEqual(result, {
    probe: "dealer_breaks_assignment_relation",
    status: 400,
    provider_code: "PGRST200",
    relation_ready: false,
  });
  assert.doesNotMatch(rendered, new RegExp(rawUuid));
  assert.doesNotMatch(rendered, /example\.test|private URL|header/);
});

test("relation probe fails closed if limit zero unexpectedly yields a row", async () => {
  const fixture = adminResponse({ data: [{ assignment_id: "not-logged" }], error: null, status: 200 });
  const result = await probeCandidateBreakRelation({ admin: fixture.admin });
  assert.deepEqual(result, {
    probe: "dealer_breaks_assignment_relation",
    status: 200,
    provider_code: "UNEXPECTED_ROWS",
    relation_ready: false,
  });
});
