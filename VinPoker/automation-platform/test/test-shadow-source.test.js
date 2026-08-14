import test from "node:test";
import assert from "node:assert/strict";
import { mapCanonicalRows } from "../src/canonical/test-shadow-source.js";
import { digestCanonicalSnapshotContentV2 } from "../src/lib/digest-snapshot-hash.js";

test("canonical TEST rows expose immutable snapshots without recomputing metrics", () => {
  const clubs = mapCanonicalRows([
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1_200_000),
    row("B", "10000000-0000-4000-8000-000000000002", 5, 1, null),
  ]);
  const first = clubs[0].canonical_snapshot;
  assert.equal(first.snapshot_version, 3);
  assert.deepEqual(first.content_payload.metrics.entries_count, { value: 12, state: "AVAILABLE" });
  assert.deepEqual(first.content_payload.metrics.staff_count, { value: 2, state: "AVAILABLE" });
  assert.deepEqual(first.content_payload.metrics.rake_paid_vnd, { value: 1_200_000, state: "AVAILABLE" });
  assert.equal(first.content_payload.money_state, "PROVISIONAL");
  assert.equal(clubs[0].canonical_event.event_type, "owner.daily_digest.snapshot_created");
  assert.equal(clubs[0].canonical_event.payload.content_hash, first.content_hash);
  assert.equal(clubs[0].canonical_event.content_artifact_id, first.snapshot_id);
  assert.deepEqual(
    clubs[1].canonical_snapshot.content_payload.metrics.rake_paid_vnd,
    { value: null, state: "UNAVAILABLE" },
  );
  assert.notEqual(clubs[0].mock_owner_endpoint_id, clubs[1].mock_owner_endpoint_id);
});

test("canonical TEST mapper rejects incomplete, non-allowlisted or tampered snapshots", () => {
  assert.throws(() => mapCanonicalRows([]), /exactly the two allowlisted clubs/);
  const rows = [
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1),
    row("B", "99999999-0000-4000-8000-000000000002", 5, 1, 1),
  ];
  assert.throws(() => mapCanonicalRows(rows), /identity mismatch/);

  const valid = [
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1),
    row("B", "10000000-0000-4000-8000-000000000002", 5, 1, 1),
  ];
  valid[0].content_hash = "0".repeat(64);
  assert.throws(() => mapCanonicalRows(valid), /checksum mismatch/);

  const tamperedOutbox = [
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1),
    row("B", "10000000-0000-4000-8000-000000000002", 5, 1, 1),
  ];
  tamperedOutbox[0].outbox_payload.content_hash = "f".repeat(64);
  assert.throws(() => mapCanonicalRows(tamperedOutbox), /outbox event does not match/);
});

function row(suffix, clubId, entries, staff, rake) {
  const contentPayload = {
    business_date: "2026-08-08",
    calculation_version: "owner-daily-digest-v2.0.0",
    effective_timezone: "Asia/Bangkok",
    window_start_utc: "2026-08-07T23:00:00.000Z",
    window_end_utc: "2026-08-08T23:00:00.000Z",
    freshness_state: rake === null ? "PARTIAL" : "FRESH",
    money_state: "PROVISIONAL",
    metrics: {
      registered_players: { value: entries, state: "AVAILABLE" },
      attendance_players: { value: entries, state: "AVAILABLE" },
      entries_count: { value: entries, state: "AVAILABLE" },
      staff_count: { value: staff, state: "AVAILABLE" },
      rake_paid_vnd: { value: rake, state: rake === null ? "UNAVAILABLE" : "AVAILABLE" },
      service_fee_paid_vnd: { value: rake === null ? null : 0, state: rake === null ? "UNAVAILABLE" : "AVAILABLE" },
      fnb_net_revenue_vnd: { value: 300_000, state: "AVAILABLE" },
      payout_outstanding_vnd: { value: 3_000_000, state: "AVAILABLE" },
      dealer_payroll_outstanding_vnd: { value: 1_500_000, state: "AVAILABLE" },
    },
    warning_codes: rake === null ? ["REGISTRATION_FEE_SPLIT_UNAVAILABLE"] : [],
    action_codes: rake === null ? ["REVIEW_LEGACY_REGISTRATIONS"] : [],
  };
  const hash = digestCanonicalSnapshotContentV2(contentPayload);
  const snapshotId = suffix === "A"
    ? "50000000-0000-4000-8000-000000000001"
    : "50000000-0000-4000-8000-000000000002";
  const eventId = suffix === "A"
    ? "60000000-0000-4000-8000-000000000001"
    : "60000000-0000-4000-8000-000000000002";
  return {
    club_id: clubId,
    owner_id: suffix === "A"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
    display_code: `TEST_CLUB_${suffix}`,
    snapshot_id: snapshotId,
    snapshot_version: "3",
    calculation_version: "owner-daily-digest-v2.0.0",
    source_as_of: "2026-08-09T00:00:00.000Z",
    generated_at: "2026-08-09T00:00:01.000Z",
    notification_expires_at: "2026-08-09T08:00:01.000Z",
    source_hash: hash,
    content_hash: hash,
    content_payload: contentPayload,
    event_id: eventId,
    event_type: "owner.daily_digest.snapshot_created",
    dedupe_key: `owner-digest:${clubId}:2026-08-08:${hash}`,
    outbox_payload: {
      snapshot_id: snapshotId,
      club_id: clubId,
      business_date: "2026-08-08",
      snapshot_version: 3,
      calculation_version: "owner-daily-digest-v2.0.0",
      content_hash: hash,
      schema_version: 2,
    },
    event_occurred_at: "2026-08-09T00:00:01.000Z",
    event_available_at: "2026-08-09T00:00:01.000Z",
    event_expires_at: "2026-08-09T08:00:01.000Z",
  };
}
