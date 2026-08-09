import test from "node:test";
import assert from "node:assert/strict";
import { verifyShadowEvidence } from "../src/canonical/verify-test-shadow.js";

test("TEST shadow verifier compares canonical metrics and tenant-scoped mock delivery", () => {
  const club = {
    club_id: "10000000-0000-4000-8000-000000000001",
    display_code: "TEST_CLUB_A",
    mock_owner_endpoint_id: "00000000-0000-4000-8000-000000000001",
    snapshot: {
      registrations: 12,
      attendance: 12,
      entries: 12,
      staff: 2,
      rake_retained_vnd: 1_200_000,
      fnb_net_revenue_vnd: 300_000,
      pending_liabilities_vnd: 3_000_000,
      payroll_provisional_vnd: 1_500_000,
    },
  };
  const result = verifyShadowEvidence({
    clubs: [club],
    evidence: [{
      event: {
        event_id: "event-a",
        correlation_id: "trace-a",
        scheduled_for: "2026-08-10T00:00:00Z",
        scope: { club_id: club.club_id },
      },
      event_status: "COMPLETED",
      artifact: {
        artifact_id: "artifact-a",
        schema_version: 1,
        club_id: club.club_id,
        content_payload: { money_state: "PROVISIONAL", metrics: club.snapshot },
      },
      notification_id: "notification-a",
      delivery: {
        status: "SENT",
        scope: { club_id: club.club_id },
        recipient_endpoint_id: club.mock_owner_endpoint_id,
      },
    }],
    status: { external_send_enabled: false, dead_letter_count: 0 },
  });
  assert.equal(result.pass, true);
  assert.equal(result.duplicates, 0);
  assert.equal(result.tenant_isolation, "PASS");
});
