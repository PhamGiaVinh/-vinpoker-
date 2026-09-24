import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentRedirect } from "./DocumentRedirect";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

afterEach(() => {
  if (originalLocation) Object.defineProperty(window, "location", originalLocation);
});

describe("DocumentRedirect", () => {
  it("loads the Ops document without copying the legacy Cashier query", () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "https://vinpoker.vercel.app",
        search: "?tab=offline_buyin",
        hash: "#legacy",
        replace,
      },
    });

    render(<DocumentRedirect to="/ops/cashier/tour?club=club-a" preserveCurrentLocation={false} />);

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("https://vinpoker.vercel.app/ops/cashier/tour?club=club-a");
  });
});
