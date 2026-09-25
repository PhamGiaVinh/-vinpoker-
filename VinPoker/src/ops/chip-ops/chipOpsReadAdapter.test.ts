import { describe, expect, it } from "vitest";
import { parseIssuedChipInventory, parseIssuedStackSummary } from "./chipOpsReadAdapter";

describe("Chip Master issued snapshot", () => {
  it("keeps stack sets, physical chip counts and chip values separate", () => {
    const stacks = parseIssuedStackSummary(
      [
        { id: "standard", name: "Standard", stack_value: 50000 },
        { id: "deep", name: "Deep", stack_value: 100000 },
      ],
      [{ stack_template_id: "standard", issued_count: 10 }, { stack_template_id: "deep", issued_count: 2 }],
    );
    const inventory = parseIssuedChipInventory({
      tournament_id: "tour-1",
      denominations: [
        { denomination_id: "d1", value: 100, color: "red", issued_count_total: 20 },
        { denomination_id: "d2", value: 1000, color: "blue", issued_count_total: 50 },
      ],
      total_value: 52000,
      reconciliation_value: 52000,
      reconciled: true,
    }, "tour-1");
    expect(stacks.totalIssuedStacks).toBe(12);
    expect(inventory.totalIssuedChips).toBe(70);
    expect(inventory.totalValue).toBe(52000);
  });

  it("rejects an issuance row outside the selected template set", () => {
    expect(() => parseIssuedStackSummary(
      [{ id: "standard", name: "Standard", stack_value: 50000 }],
      [{ stack_template_id: "other-tour", issued_count: 1 }],
    )).toThrow("CHIP_OPS_ISSUANCE_MALFORMED");
  });
});
