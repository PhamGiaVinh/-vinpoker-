import test from "node:test";
import assert from "node:assert/strict";
import { mapCanonicalRows } from "../src/canonical/test-shadow-source.js";

test("canonical TEST rows map exact metrics and preserve provisional payroll semantics", () => {
  const clubs = mapCanonicalRows([
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1_200_000, 300_000, 3_000_000, 1_500_000),
    row("B", "10000000-0000-4000-8000-000000000002", 5, 1, 250_000, 125_000, 500_000, 700_000),
  ]);
  assert.equal(clubs[0].snapshot.entries, 12);
  assert.equal(clubs[0].snapshot.staff, 2);
  assert.equal(clubs[0].snapshot.rake_retained_vnd, 1_200_000);
  assert.equal(clubs[0].snapshot.payroll_provisional_vnd, 1_500_000);
  assert.equal(clubs[0].snapshot.money_state, "PROVISIONAL");
  assert.equal(clubs[1].snapshot.entries, 5);
  assert.equal(clubs[1].snapshot.staff, 1);
  assert.notEqual(clubs[0].mock_owner_endpoint_id, clubs[1].mock_owner_endpoint_id);
});

test("canonical TEST mapper rejects incomplete or non-allowlisted club results", () => {
  assert.throws(() => mapCanonicalRows([]), /exactly the two allowlisted clubs/);
  const rows = [
    row("A", "10000000-0000-4000-8000-000000000001", 12, 2, 1, 1, 1, 1),
    row("B", "99999999-0000-4000-8000-000000000002", 5, 1, 1, 1, 1, 1),
  ];
  assert.throws(() => mapCanonicalRows(rows), /identity mismatch/);
});

function row(suffix, clubId, entries, staff, rake, fnb, liabilities, payroll) {
  return {
    club_id: clubId,
    owner_id: suffix === "A"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
    display_code: `TEST_CLUB_${suffix}`,
    registrations: String(entries),
    attendance: String(entries),
    entries: String(entries),
    staff: String(staff),
    rake_retained_vnd: String(rake),
    fnb_net_revenue_vnd: String(fnb),
    pending_liabilities_vnd: String(liabilities),
    payroll_provisional_vnd: String(payroll),
  };
}
