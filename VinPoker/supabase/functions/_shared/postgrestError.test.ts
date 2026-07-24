import { assertEquals } from "jsr:@std/assert@1";
import { classifyPostgrestError, postgrestHttpStatus } from "./postgrestError.ts";

Deno.test("classifies missing schema dependencies without retaining raw messages", () => {
  assertEquals(
    classifyPostgrestError({
      code: "42703",
      message: "column game_tables.dealer_open_operation_id does not exist",
    }),
    { status: "dependency_unavailable", sanitizedCode: "42703" },
  );
});

Deno.test("classifies unrecognised query errors with a stable sanitized code", () => {
  assertEquals(
    classifyPostgrestError({ code: "XX000", message: "connection reset at private host" }),
    { status: "query_failed", sanitizedCode: "XX000" },
  );
  assertEquals(
    classifyPostgrestError(new Error("unstructured failure with private details")),
    { status: "query_failed", sanitizedCode: "QUERY_FAILED" },
  );
});

Deno.test("retains only a valid HTTP status for structured diagnostics", () => {
  assertEquals(postgrestHttpStatus({ status: 414, message: "private request URL" }), 414);
  assertEquals(postgrestHttpStatus({ status: 200, message: "not an error" }), null);
  assertEquals(postgrestHttpStatus({ status: "414", message: "untrusted string" }), null);
});
