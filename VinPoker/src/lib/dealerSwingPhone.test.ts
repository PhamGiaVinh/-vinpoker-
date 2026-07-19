import { describe, expect, it } from "vitest";
import {
  parseDealerUserQr,
  resolveDealerPhoneRollout,
} from "@/lib/dealerSwingPhone";

const USER_ID = "12345678-1234-4abc-8def-1234567890ab";

describe("parseDealerUserQr", () => {
  it("accepts only the exact VinPoker user URI", () => {
    expect(parseDealerUserQr(`vinpoker://user/${USER_ID}`)).toBe(USER_ID);
  });

  it.each([
    USER_ID,
    ` ${`vinpoker://user/${USER_ID}`}`,
    `${`vinpoker://user/${USER_ID}`} `,
    `https://vinpoker.vn/user/${USER_ID}`,
    `vinpoker://user/${USER_ID}?source=phone`,
    `vinpoker://user/${USER_ID}#member`,
    `vinpoker://user/${USER_ID}/`,
    `Vinpoker://user/${USER_ID}`,
    `vinpoker://user/${USER_ID.toUpperCase()}`,
    "vinpoker://user/not-a-uuid",
  ])("rejects non-canonical input: %s", (value) => {
    expect(parseDealerUserQr(value)).toBeNull();
  });
});

describe("resolveDealerPhoneRollout", () => {
  it("fails closed without a server state", () => {
    expect(resolveDealerPhoneRollout(null, true)).toBe(false);
  });

  it("lets the master switch override every other gate", () => {
    expect(resolveDealerPhoneRollout({
      master_enabled: false,
      allowlisted: true,
      all_clubs_enabled: true,
    }, true)).toBe(false);
  });

  it("allows a TEST-club allowlist while the wide source flag stays off", () => {
    expect(resolveDealerPhoneRollout({
      master_enabled: true,
      allowlisted: true,
      all_clubs_enabled: false,
    }, false)).toBe(true);
  });

  it("requires both source and server gates for a wide rollout", () => {
    const serverState = {
      master_enabled: true,
      allowlisted: false,
      all_clubs_enabled: true,
    };
    expect(resolveDealerPhoneRollout(serverState, false)).toBe(false);
    expect(resolveDealerPhoneRollout(serverState, true)).toBe(true);
  });
});
