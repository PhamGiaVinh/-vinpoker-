import assert from "node:assert/strict";
import test from "node:test";
import { selectMonitoredClubs, summarizeMonitor } from "./monitor-process-swing-dark.mjs";

const HSOP = "22222222-2222-2222-2222-222222222222";
const CONTROL = "33333333-3333-3333-3333-333333333333";
const RAW_UUID = "99999999-9999-9999-9999-999999999999";

function dispatch(clubId, minute, overrides = {}) {
  const at = new Date(Date.UTC(2026, 6, 25, 10, minute, 0));
  return {
    club_id: clubId,
    tick_at: at.toISOString(),
    requested_at: at.toISOString(),
    timeout_ms: 55_000,
    lease_expires_at: new Date(at.getTime() - 1_000).toISOString(),
    transport_state: "succeeded",
    business_state: "completed",
    business_error_code: null,
    ...overrides,
  };
}

function healthyRows() {
  return Array.from({ length: 15 }, (_, index) => [dispatch(HSOP, index), dispatch(CONTROL, index)]).flat();
}

test("monitor selects HSOP and a non-PII control club without exposing ids", () => {
  const selected = selectMonitoredClubs([dispatch(HSOP, 0), dispatch(CONTROL, 0)]);
  assert.equal(selected.errorCode, undefined);
  assert.equal(selected.roleByClub.get(HSOP), "hsop");
  assert.equal(selected.roleByClub.get(CONTROL), "control");
});

test("monitor passes a healthy fifteen-tick snapshot", () => {
  const rows = healthyRows();
  const roleByClub = selectMonitoredClubs(rows).roleByClub;
  const result = summarizeMonitor({
    dispatchRows: rows,
    alertRows: [],
    roleByClub,
    startMs: Date.UTC(2026, 6, 25, 10, 0, 0),
    nowMs: Date.UTC(2026, 6, 25, 10, 16, 0),
    requiredTicks: 15,
  });
  assert.equal(result.monitor_status, "pass");
  assert.equal(result.dispatch.hsop.dispatch_ticks, 15);
  assert.equal(result.dispatch.control.dispatch_ticks, 15);
  assert.doesNotMatch(JSON.stringify(result), /22222222|33333333/);
});

test("monitor fails closed for candidate-break failure, stale pending, overlap, and false alert", () => {
  const rows = healthyRows();
  rows.push(dispatch(HSOP, 15, {
    transport_state: "pending",
    business_state: "started",
    lease_expires_at: new Date(Date.UTC(2026, 6, 25, 10, 20, 0)).toISOString(),
    business_error_code: "candidate_assignment_breaks_query_failed",
  }));
  rows.push(dispatch(HSOP, 15, {
    transport_state: "succeeded",
    business_state: "started",
    lease_expires_at: new Date(Date.UTC(2026, 6, 25, 10, 21, 0)).toISOString(),
  }));
  const roleByClub = selectMonitoredClubs(rows).roleByClub;
  const result = summarizeMonitor({
    dispatchRows: rows,
    alertRows: [{
      club_id: HSOP,
      classification: "healthy",
      status: "open",
      last_notified_at: new Date(Date.UTC(2026, 6, 25, 10, 5, 0)).toISOString(),
      error_code: null,
    }],
    roleByClub,
    startMs: Date.UTC(2026, 6, 25, 10, 0, 0),
    nowMs: Date.UTC(2026, 6, 25, 10, 16, 0),
    requiredTicks: 15,
  });
  assert.equal(result.monitor_status, "failed");
  assert.deepEqual(result.failure_codes, [
    "HSOP_CANDIDATE_BREAK_QUERY_FAILURE",
    "HSOP_FALSE_SHORTAGE_NOTIFICATION",
    "HSOP_LEASE_OVERLAP",
  ]);
});

test("monitor requires a distinct control club", () => {
  assert.deepEqual(selectMonitoredClubs([dispatch(HSOP, 0)]), { errorCode: "CONTROL_CLUB_NO_DISPATCH" });
});

test("monitor output never contains raw club ids or unknown error payloads", () => {
  const rows = healthyRows();
  rows[0].business_error_code = `private-${RAW_UUID}`;
  const roleByClub = selectMonitoredClubs(rows).roleByClub;
  const result = summarizeMonitor({
    dispatchRows: rows,
    alertRows: [],
    roleByClub,
    startMs: Date.UTC(2026, 6, 25, 10, 0, 0),
    nowMs: Date.UTC(2026, 6, 25, 10, 16, 0),
    requiredTicks: 15,
  });
  const rendered = JSON.stringify(result);
  assert.match(rendered, /UNSAFE_ERROR_CODE/);
  assert.doesNotMatch(rendered, new RegExp(RAW_UUID));
  assert.doesNotMatch(rendered, /22222222|33333333|private-/);
});
