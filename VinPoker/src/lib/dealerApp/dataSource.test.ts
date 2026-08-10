import { afterEach, describe, expect, it } from "vitest";
import { dealerDataSource, isDealerCustomerPreview } from "./dataSource";

describe("dealer customer preview data source", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("uses isolated mock data only for the explicit customer preview URL", () => {
    window.history.replaceState({}, "", "/dealer/salary?customer_preview=1");

    expect(isDealerCustomerPreview()).toBe(true);
    expect(dealerDataSource()).toBe("mock");
  });

  it("keeps the ordinary dealer app on its configured data source", () => {
    window.history.replaceState({}, "", "/dealer/salary");

    expect(isDealerCustomerPreview()).toBe(false);
    expect(dealerDataSource()).toBe("live");
  });
});
