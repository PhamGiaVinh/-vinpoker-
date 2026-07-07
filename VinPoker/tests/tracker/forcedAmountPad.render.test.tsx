// C1 BUGFIX — ForcedAmountPad min-raise boundary. Entering EXACTLY the minimum
// raise-to (e.g. 400k over a 200k BB with 100k/200k blinds) is a LEGAL min-raise and
// must NOT show the "dưới mức tố tối thiểu" warning; strictly below the minimum must.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ForcedAmountPad } from "@/components/tracker/ForcedAmountPad";

afterEach(() => cleanup());

const noop = () => {};

function setup() {
  // BB seat pre-flop with 100k/200k blinds: committed 200k, stack 10M, minTotal 400k.
  render(
    <ForcedAmountPad stack={10_000_000} committedThisStreet={200_000} minTotal={400_000} onConfirm={noop} onCancel={noop} />
  );
}

function typeDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: d }));
  }
}

describe("ForcedAmountPad min-raise boundary (C1)", () => {
  it("entering EXACTLY the min raise-to (400k) shows NO below-min warning", () => {
    setup();
    typeDigits("400000");
    expect(screen.queryByText(/dưới mức tố tối thiểu/)).toBeNull();
  });

  it("entering BELOW the min raise-to (399k) shows the warning", () => {
    setup();
    typeDigits("399000");
    expect(screen.getByText(/dưới mức tố tối thiểu/)).toBeTruthy();
  });
});
