import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboard } from "../src/dashboard.js";

test("dashboard makes local boundaries and operational state explicit", () => {
  const html = renderDashboard({
    status: {
      environment: "DEV",
      external_send_enabled: false,
      p0_owner: "SERVER_NATIVE",
      counts: { PENDING: 2, LEASED: 0, COMPLETED: 0 },
      backlog_count: 2,
      oldest_event_age_seconds: 61,
      dead_letter_count: 0,
      artifact_count: 0,
      notification_count: 0,
      heartbeats: [],
      kill_switches: [],
    },
  });
  assert.match(html, /DEV LOCAL · FIXTURE · KHÔNG PHẢI LIVE/);
  assert.match(html, /P0: SERVER-NATIVE/);
  assert.match(html, /EXTERNAL SEND: OFF/);
  assert.match(html, /Server schedule → durable enqueue/);
});

test("dashboard escapes trace content", () => {
  const html = renderDashboard({
    status: {
      environment: "DEV",
      counts: {},
      backlog_count: 0,
      oldest_event_age_seconds: 0,
      dead_letter_count: 0,
      heartbeats: [],
      kill_switches: [],
    },
    traceId: "<script>alert(1)</script>",
    trace: { events: [] },
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
