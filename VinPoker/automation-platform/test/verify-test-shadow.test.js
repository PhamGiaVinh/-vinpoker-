import test from "node:test";
import assert from "node:assert/strict";
import { verifyShadowEvidence } from "../src/canonical/verify-test-shadow.js";

test("TEST shadow verifier compares canonical snapshot and tenant-scoped mock delivery", () => {
  const club = {
    club_id: "10000000-0000-4000-8000-000000000001",
    display_code: "TEST_CLUB_A",
    mock_owner_endpoint_id: "00000000-0000-4000-8000-000000000001",
    canonical_event: {
      event_id: "60000000-0000-4000-8000-000000000001",
      event_type: "owner.daily_digest.snapshot_created",
    },
    canonical_snapshot: {
      content_payload: {
        money_state: "PROVISIONAL",
        metrics: {
          registered_players: { value: 12, state: "AVAILABLE" },
          attendance_players: { value: 12, state: "AVAILABLE" },
          entries_count: { value: 12, state: "AVAILABLE" },
          staff_count: { value: 2, state: "AVAILABLE" },
          rake_paid_vnd: { value: 1_200_000, state: "AVAILABLE" },
          service_fee_paid_vnd: { value: 0, state: "AVAILABLE" },
          fnb_net_revenue_vnd: { value: 300_000, state: "AVAILABLE" },
          payout_outstanding_vnd: { value: 3_000_000, state: "AVAILABLE" },
          dealer_payroll_outstanding_vnd: { value: 1_500_000, state: "AVAILABLE" },
        },
      },
    },
  };
  const result = verifyShadowEvidence({
    clubs: [club],
    evidence: [{
      event: {
        event_id: "60000000-0000-4000-8000-000000000001",
        event_type: "owner.daily_digest.snapshot_created",
        correlation_id: "trace-a",
        occurred_at: "2026-08-10T00:00:00Z",
        scope: { club_id: club.club_id },
      },
      event_status: "COMPLETED",
      artifact: {
        artifact_id: "artifact-a",
        schema_version: 2,
        club_id: club.club_id,
        content_payload: club.canonical_snapshot.content_payload,
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
