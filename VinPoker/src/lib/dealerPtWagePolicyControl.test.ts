import { describe, expect, it } from "vitest";
import {
  buildDealerPtWagePolicyRequest,
  PT_WAGE_POLICY_REASON_LIMIT,
} from "./dealerPtWagePolicyControl";

describe("buildDealerPtWagePolicyRequest", () => {
  it("requests continuous accrual for every unpaid minute without a client amount", () => {
    expect(buildDealerPtWagePolicyRequest("club-1", true, "  Owner UAT  "))
      .toEqual({
        p_club_id: "club-1",
        p_standby_accrual_enabled: true,
        p_effective_from: null,
        p_reason: "Owner UAT",
      });
  });

  it("uses the same server contract to disable a club policy", () => {
    expect(
      buildDealerPtWagePolicyRequest(
        "club-1",
        false,
        "Stop continuous accrual",
      ),
    ).toMatchObject({
      p_standby_accrual_enabled: false,
      p_effective_from: null,
    });
  });

  it("rejects missing club and invalid audit reasons before calling the RPC", () => {
    expect(() => buildDealerPtWagePolicyRequest("", true, "reason")).toThrow(
      "câu lạc bộ",
    );
    expect(() => buildDealerPtWagePolicyRequest("club-1", true, "   ")).toThrow(
      "lý do",
    );
    expect(() =>
      buildDealerPtWagePolicyRequest(
        "club-1",
        true,
        "x".repeat(PT_WAGE_POLICY_REASON_LIMIT + 1),
      )
    ).toThrow("tối đa");
  });
});
