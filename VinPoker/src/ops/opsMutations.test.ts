import { describe, expect, it } from "vitest";
import { assertMutationOk, mutationError } from "./opsMutations";

describe("Ops mutation result contract", () => {
  it("accepts a server-confirmed JSON result", () => {
    expect(assertMutationOk({ ok: true, id: "fixture" })).toEqual({ ok: true, id: "fixture" });
    expect(assertMutationOk({ success: true })).toEqual({ success: true });
  });

  it("rejects explicit server failures without treating a toast as success", () => {
    expect(() => assertMutationOk({ ok: false, error: "seat_entry_mismatch" }))
      .toThrow("seat_entry_mismatch");
    expect(() => assertMutationOk({ success: false, error: "forbidden" }))
      .toThrow("forbidden");
  });

  it("prefers a server error code over transport text", () => {
    expect(mutationError(new Error("HTTP 400"), { error: "reason_required_on_mismatch" }).message)
      .toBe("reason_required_on_mismatch");
  });
});
