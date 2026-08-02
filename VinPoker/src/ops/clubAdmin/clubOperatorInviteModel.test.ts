import { describe, expect, it } from "vitest";
import { inviteStatusLabel, isOperatorInviteRole, operatorInviteRoles } from "./clubOperatorInviteModel";

describe("club operator invitation model", () => {
  it("only exposes Floor and Cashier roles", () => {
    expect(operatorInviteRoles).toEqual(["floor", "cashier"]);
    expect(isOperatorInviteRole("floor")).toBe(true);
    expect(isOperatorInviteRole("cashier")).toBe(true);
    expect(isOperatorInviteRole("owner")).toBe(false);
    expect(isOperatorInviteRole("club_admin")).toBe(false);
  });

  it("labels revoked membership clearly", () => {
    expect(inviteStatusLabel("active")).toBe("Đang có quyền");
    expect(inviteStatusLabel("revoked")).toBe("Đã thu hồi");
  });
});
