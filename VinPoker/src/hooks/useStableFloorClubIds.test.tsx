import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableFloorClubIds } from "./useStableFloorClubIds";

describe("useStableFloorClubIds", () => {
  it("preserves array identity when membership is semantically unchanged", () => {
    const { result, rerender } = renderHook(
      ({ operatorIds, dealerIds }) => useStableFloorClubIds(operatorIds, dealerIds),
      {
        initialProps: {
          operatorIds: ["club-b", "club-a"],
          dealerIds: ["club-a"],
        },
      },
    );
    const firstScope = result.current;
    expect(firstScope).toEqual(["club-a", "club-b"]);

    rerender({
      operatorIds: ["club-a", "club-b"],
      dealerIds: ["club-b", "club-a"],
    });

    expect(result.current).toBe(firstScope);
  });

  it("returns a new stable scope when membership really changes", () => {
    const { result, rerender } = renderHook(
      ({ operatorIds, dealerIds }) => useStableFloorClubIds(operatorIds, dealerIds),
      {
        initialProps: {
          operatorIds: ["club-a"],
          dealerIds: [] as string[],
        },
      },
    );
    const firstScope = result.current;

    rerender({ operatorIds: ["club-a"], dealerIds: ["club-c"] });

    expect(result.current).not.toBe(firstScope);
    expect(result.current).toEqual(["club-a", "club-c"]);
  });
});
