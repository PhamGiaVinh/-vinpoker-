import {
  clockControlErrorStatus,
  isPostStartClockAction,
  isTerminalTournamentStatus,
  parseClockDelta,
  POST_START_CLOCK_ACTIONS,
  readExpectedControlRevision,
  readLegacyControlRevision,
} from "./controlPolicy.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("post-start action allowlist rejects unreviewed actions", () => {
  for (const action of POST_START_CLOCK_ACTIONS) {
    assertEquals(isPostStartClockAction(action), true, action);
  }
  assertEquals(isPostStartClockAction("start"), false, "start is separate");
  assertEquals(isPostStartClockAction("close"), false, "close is forbidden");
});

Deno.test("terminal status guard includes legacy finished", () => {
  for (const status of ["completed", "cancelled", "finished"]) {
    assertEquals(isTerminalTournamentStatus(status), true, status);
  }
  assertEquals(isTerminalTournamentStatus("live"), false, "live remains open");
});

Deno.test("delta parser normalizes minutes and enforces integer bounds", () => {
  assertEquals(
    parseClockDelta({ delta_seconds: 60 }),
    { ok: true, value: 60 },
    "seconds",
  );
  assertEquals(
    parseClockDelta({ delta_minutes: -1 }),
    { ok: true, value: -60 },
    "minutes",
  );
  assertEquals(
    parseClockDelta({ delta_seconds: 1.5 }),
    { ok: false, error: "delta_must_be_integer" },
    "integer",
  );
  assertEquals(
    parseClockDelta({ delta_seconds: 86401 }),
    { ok: false, error: "delta_too_large" },
    "upper bound",
  );
});

Deno.test("error mapping preserves auth, validation and conflict classes", () => {
  assertEquals(clockControlErrorStatus("actor_not_allowed"), 403, "auth");
  assertEquals(clockControlErrorStatus("delta_too_large"), 400, "validation");
  assertEquals(
    clockControlErrorStatus("legacy_client_revision_required"),
    400,
    "legacy validation",
  );
  assertEquals(clockControlErrorStatus("stale_clock_state"), 409, "conflict");
});

Deno.test("caller revision is accepted only as an opaque md5 token", () => {
  assertEquals(
    readExpectedControlRevision({
      expected_control_revision: "0123456789abcdef0123456789abcdef",
    }),
    "0123456789abcdef0123456789abcdef",
    "valid revision",
  );
  assertEquals(readExpectedControlRevision({}), null, "missing revision");
  assertEquals(
    readExpectedControlRevision({ expected_control_revision: "not-a-token" }),
    null,
    "malformed revision",
  );
});

Deno.test("legacy rollback compatibility is idempotent or target-bound", () => {
  const clock = {
    control_revision: "0123456789abcdef0123456789abcdef",
    current_level: { level_number: 4 },
  };
  assertEquals(
    readLegacyControlRevision("pause", {}, clock),
    clock.control_revision,
    "pause",
  );
  assertEquals(
    readLegacyControlRevision("resume", {}, clock),
    clock.control_revision,
    "resume",
  );
  assertEquals(
    readLegacyControlRevision("next_level", { current_level: 5 }, clock),
    clock.control_revision,
    "next target",
  );
  assertEquals(
    readLegacyControlRevision("previous_level", { current_level: 3 }, clock),
    clock.control_revision,
    "previous target",
  );
  assertEquals(
    readLegacyControlRevision("next_level", { current_level: 4 }, clock),
    null,
    "stale next target",
  );
  assertEquals(
    readLegacyControlRevision("adjust_time", { delta_seconds: 60 }, clock),
    null,
    "adjust requires browser revision",
  );
});
