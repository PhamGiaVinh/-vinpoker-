import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  assessEmptyFillOutcome,
  parseProcessSwingDispatchContext,
} from "./dispatchContext.ts";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CLUB_ID = "22222222-2222-2222-2222-222222222222";

Deno.test("dispatch correlation is optional for legacy internal/manual callers", () => {
  assertEquals(parseProcessSwingDispatchContext({ club_id: CLUB_ID }), null);
});

Deno.test("dispatch correlation accepts one canonical club", () => {
  assertEquals(parseProcessSwingDispatchContext({
    club_id: CLUB_ID,
    run_id: RUN_ID,
    request_id: REQUEST_ID,
    tick_at: "2026-07-20T12:34:00Z",
  }), {
    clubId: CLUB_ID,
    runId: RUN_ID,
    requestId: REQUEST_ID,
    tickAt: "2026-07-20T12:34:00.000Z",
  });
});

Deno.test("partial, multi-club and malformed correlation fail closed", () => {
  assertThrows(() => parseProcessSwingDispatchContext({
    club_id: CLUB_ID,
    run_id: RUN_ID,
  }), TypeError);
  assertThrows(() => parseProcessSwingDispatchContext({
    club_ids: [CLUB_ID],
    run_id: RUN_ID,
    request_id: REQUEST_ID,
    tick_at: "2026-07-20T12:34:00Z",
  }), TypeError);
  assertThrows(() => parseProcessSwingDispatchContext({
    club_id: CLUB_ID,
    run_id: "not-a-uuid",
    request_id: REQUEST_ID,
    tick_at: "2026-07-20T12:34:00Z",
  }), TypeError);
});

Deno.test("rotation continues but shortage alerts stop when empty fill is degraded", () => {
  assertEquals(assessEmptyFillOutcome("query_failed", "candidate_query_failed"), {
    continueRotation: true,
    shortageAlertsAllowed: false,
    dispatchState: "partial",
    dispatchErrorCode: "candidate_query_failed",
  });
  assertEquals(assessEmptyFillOutcome("dependency_unavailable", "missing_column"), {
    continueRotation: true,
    shortageAlertsAllowed: false,
    dispatchState: "dependency_unavailable",
    dispatchErrorCode: "missing_column",
  });
});
