import { assertEquals, assertNotMatch } from "jsr:@std/assert@1";
import {
  candidateSnapshotFailureDiagnostic,
  durationBucket,
  inputCountBucket,
} from "./candidateSnapshotTelemetry.ts";

Deno.test("candidate snapshot telemetry sanitizes provider failures and uses only stable fingerprint fields", () => {
  const rawUuid = "11111111-2222-3333-4444-555555555555";
  const rawUrl = `https://private.example.test/rest/v1/dealer_breaks?id=${rawUuid}`;
  const diagnostic = candidateSnapshotFailureDiagnostic(
    "assignment_breaks",
    {
      code: "XX000",
      message: `URI too long for ${rawUuid}; url=${rawUrl}; headers=Authorization private`,
    },
    414,
    200,
    550,
  );

  assertEquals(diagnostic, {
    component: "candidate_snapshot",
    stage: "assignment_breaks",
    status: "query_failed",
    provider_code: "XX000",
    http_status: 414,
    input_count_bucket: "one_hundred_one_to_two_hundred",
    duration_bucket: "500ms_to_1999ms",
    fingerprint: "assignment_breaks|XX000|414|one_hundred_one_to_two_hundred",
  });
  assertNotMatch(JSON.stringify(diagnostic), new RegExp(rawUuid));
  assertNotMatch(JSON.stringify(diagnostic), /URI too long/);
  assertNotMatch(JSON.stringify(diagnostic), /private\.example\.test/);
  assertNotMatch(JSON.stringify(diagnostic), /Authorization/);
});

Deno.test("candidate snapshot telemetry prefers a Supabase top-level HTTP status", () => {
  const diagnostic = candidateSnapshotFailureDiagnostic(
    "assignment_breaks",
    { code: "XX000", status: 500, message: "custom client fallback" },
    414,
    50,
    10,
  );

  assertEquals(diagnostic.http_status, 414);
  assertEquals(diagnostic.fingerprint, "assignment_breaks|XX000|414|twenty_six_to_fifty");
});

Deno.test("candidate snapshot telemetry rejects invalid response statuses without falling back", () => {
  const diagnostic = candidateSnapshotFailureDiagnostic(
    "attendance_breaks",
    { code: "XX000", status: 500, message: "custom client fallback" },
    200,
    1,
    10,
  );

  assertEquals(diagnostic.http_status, null);
});

Deno.test("candidate snapshot telemetry has deterministic cardinality and duration buckets", () => {
  assertEquals([0, 1, 10, 25, 50, 100, 200, 201].map(inputCountBucket), [
    "zero",
    "one",
    "two_to_ten",
    "eleven_to_twenty_five",
    "twenty_six_to_fifty",
    "fifty_one_to_one_hundred",
    "one_hundred_one_to_two_hundred",
    "over_two_hundred",
  ]);
  assertEquals([0, 25, 100, 500, 2_000].map(durationBucket), [
    "under_25ms",
    "25ms_to_99ms",
    "100ms_to_499ms",
    "500ms_to_1999ms",
    "2s_or_more",
  ]);
});
