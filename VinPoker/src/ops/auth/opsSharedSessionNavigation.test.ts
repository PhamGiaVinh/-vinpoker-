import { describe, expect, it } from "vitest";
import {
  playerLoginUrlForOpsTarget,
  safeOpsDocumentTarget,
} from "@/ops/auth/opsSharedSessionNavigation";

describe("Ops shared-session navigation", () => {
  it("keeps an internal Ops destination including its selected club", () => {
    expect(safeOpsDocumentTarget("/ops/floor?club=club-a#tables")).toBe(
      "/ops/floor?club=club-a#tables",
    );
  });

  it.each(["/", "/auth", "//attacker.invalid/ops", "https://attacker.invalid/ops", "/not-ops"])(
    "rejects an unsafe or non-Ops return target: %s",
    (value) => {
      expect(safeOpsDocumentTarget(value)).toBeNull();
    },
  );

  it("sends an unauthenticated operator through the primary app login", () => {
    expect(playerLoginUrlForOpsTarget("/ops/cashier?club=club-a")).toBe(
      "/auth?next=%2Fops%2Fcashier%3Fclub%3Dclub-a",
    );
    expect(playerLoginUrlForOpsTarget(null)).toBe("/auth?next=%2Fops");
  });
});
