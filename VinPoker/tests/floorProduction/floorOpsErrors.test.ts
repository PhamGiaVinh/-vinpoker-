import { describe, expect, it } from "vitest";
import { floorOpsFunctionErrorCode } from "@/lib/floorOpsErrors";

describe("Floor function error parsing", () => {
  it("reads the sanitized Floor error code from an HTTP function response", async () => {
    await expect(floorOpsFunctionErrorCode(null, {
      message: "Edge Function returned a non-2xx status code",
      context: { json: async () => ({ error: "seat_entry_mismatch" }) },
    })).resolves.toBe("seat_entry_mismatch");
  });
});
