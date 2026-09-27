import { assertEquals } from "jsr:@std/assert@1";
import { shouldPersistPass3Diagnostic, type DiagnosticResult } from "./diagnostics.ts";

function diagnostic(overrides: Partial<DiagnosticResult> = {}): DiagnosticResult {
  return {
    timestamp: "2026-09-27T00:00:00.000Z",
    club_id: "22222222-2222-2222-2222-222222222222",
    simple_query: { count: 0, data_length: 0, error: null, sample_ids: [] },
    nested_query: { data_length: 0, error: null },
    fk_verification: null,
    lost_rows: 0,
    confirmed_bug: false,
    ...overrides,
  };
}

Deno.test("healthy Pass 3 diagnostics are not persisted as query issues", () => {
  assertEquals(shouldPersistPass3Diagnostic(diagnostic()), false);
});

Deno.test("real Pass 3 loss or query failures remain persistable", () => {
  assertEquals(shouldPersistPass3Diagnostic(diagnostic({ lost_rows: 1 })), true);
  assertEquals(shouldPersistPass3Diagnostic(diagnostic({ confirmed_bug: true })), true);
  assertEquals(shouldPersistPass3Diagnostic(diagnostic({
    simple_query: { count: null, data_length: 0, error: "query failed", sample_ids: [] },
  })), true);
  assertEquals(shouldPersistPass3Diagnostic(diagnostic({
    nested_query: { data_length: 0, error: "query failed" },
  })), true);
});
