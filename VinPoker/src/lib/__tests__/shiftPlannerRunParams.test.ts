import { describe, expect, it } from "vitest";
import {
  buildRunParamsExtra,
  parseRunParams,
  stableParamsKey,
  validateFinalDesignations,
  type ShiftRunParams,
} from "../shiftPlanner/runParams";

describe("parseRunParams / buildRunParamsExtra", () => {
  it("round-trips a full params object", () => {
    const p: ShiftRunParams = {
      demandOverrides: { t1: 5, t2: 0 },
      finalDesignations: { t1: ["d2", "d1"] },
    };
    const parsed = parseRunParams(buildRunParamsExtra(p));
    expect(parsed.demandOverrides).toEqual({ t1: 5, t2: 0 });
    // serializer sorts+dedups designation arrays
    expect(parsed.finalDesignations).toEqual({ t1: ["d1", "d2"] });
  });

  it("reads legacy params that only have demand_overrides (pre-Patch-2 drafts)", () => {
    const parsed = parseRunParams({ demand_overrides: { t1: 5 } });
    expect(parsed.demandOverrides).toEqual({ t1: 5 });
    expect(parsed.finalDesignations).toEqual({});
  });

  it("never throws on garbage and drops malformed values", () => {
    expect(parseRunParams(null)).toEqual({ demandOverrides: {}, finalDesignations: {} });
    expect(parseRunParams("x")).toEqual({ demandOverrides: {}, finalDesignations: {} });
    expect(parseRunParams([])).toEqual({ demandOverrides: {}, finalDesignations: {} });
    expect(parseRunParams({ final_designations: "no" }).finalDesignations).toEqual({});
    const messy = parseRunParams({
      demand_overrides: { t1: "6", t2: "abc", t3: -1 },
      final_designations: { t1: [1, null, "d1", "d1"], t2: [] },
    });
    expect(messy.demandOverrides).toEqual({ t1: 6 });
    expect(messy.finalDesignations).toEqual({ t1: ["d1"] });
  });

  it("KEEPS unknown/stale dealer ids on parse — no silent drop", () => {
    const parsed = parseRunParams({ final_designations: { t1: ["gone-dealer-id"] } });
    expect(parsed.finalDesignations.t1).toEqual(["gone-dealer-id"]);
  });

  it("buildRunParamsExtra omits empties and returns undefined when nothing set (byte-parity with old saves)", () => {
    expect(buildRunParamsExtra({ demandOverrides: {}, finalDesignations: {} })).toBeUndefined();
    expect(buildRunParamsExtra({ demandOverrides: {}, finalDesignations: { t1: [] } })).toBeUndefined();
    // demand-only day serializes exactly like the pre-Patch-2 shape (no final_designations key)
    const demandOnly = buildRunParamsExtra({ demandOverrides: { t1: 4 }, finalDesignations: {} });
    expect(demandOnly).toEqual({ demand_overrides: { t1: 4 } });
    expect(demandOnly && "final_designations" in demandOnly).toBe(false);
  });
});

describe("validateFinalDesignations", () => {
  const off = new Set(["d-off"]);
  const known = new Set(["d1", "d2", "d3", "d-off"]);

  it("flags over_cap when pins exceed need", () => {
    const issues = validateFinalDesignations({ t1: ["d1", "d2", "d3"] }, { t1: 2 }, off, known);
    expect(issues).toEqual([{ templateId: "t1", kind: "over_cap", dealerIds: ["d1", "d2", "d3"] }]);
  });

  it("uses the EFFECTIVE need (override wins over template default)", () => {
    // template default was 2, but the day override raised it to 5 → 4 pins OK
    const issues = validateFinalDesignations({ t1: ["d1", "d2", "d3", "d-off"] }, { t1: 5 }, new Set(), known);
    expect(issues).toEqual([]);
  });

  it("flags dealer_off for designees on leave/unavailable", () => {
    const issues = validateFinalDesignations({ t1: ["d1", "d-off"] }, { t1: 3 }, off, known);
    expect(issues).toEqual([{ templateId: "t1", kind: "dealer_off", dealerIds: ["d-off"] }]);
  });

  it("flags unknown_dealer for ids missing from the roster", () => {
    const issues = validateFinalDesignations({ t1: ["d1", "gone"] }, { t1: 3 }, off, known);
    expect(issues).toEqual([{ templateId: "t1", kind: "unknown_dealer", dealerIds: ["gone"] }]);
  });

  it("flags an INACTIVE dealer as unknown_dealer (known set = active dealers only)", () => {
    const activeOnly = new Set(["d1"]); // d2 exists but is inactive → not in the set
    const issues = validateFinalDesignations({ t1: ["d1", "d2"] }, { t1: 3 }, new Set(), activeOnly);
    expect(issues).toEqual([{ templateId: "t1", kind: "unknown_dealer", dealerIds: ["d2"] }]);
  });

  it("returns [] for a clean designation", () => {
    expect(validateFinalDesignations({ t1: ["d1", "d2"] }, { t1: 2 }, off, known)).toEqual([]);
  });
});

describe("stableParamsKey", () => {
  it("is invariant under key order and array order, and differs on value change", () => {
    const a = stableParamsKey({ demandOverrides: { t1: 5, t2: 3 }, finalDesignations: { t1: ["d2", "d1"] } });
    const b = stableParamsKey({ demandOverrides: { t2: 3, t1: 5 }, finalDesignations: { t1: ["d1", "d2", "d1"] } });
    expect(a).toBe(b);
    const c = stableParamsKey({ demandOverrides: { t1: 6, t2: 3 }, finalDesignations: { t1: ["d1", "d2"] } });
    expect(c).not.toBe(a);
    // empty designation arrays don't change the key
    const d = stableParamsKey({ demandOverrides: { t1: 5, t2: 3 }, finalDesignations: { t1: ["d1", "d2"], t9: [] } });
    expect(d).toBe(a);
  });
});
