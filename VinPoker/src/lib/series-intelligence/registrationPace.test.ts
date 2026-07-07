import { describe, it, expect } from "vitest";
import { registrationPace, type RegPaceInput } from "./registrationPace";

const inp = (over: Partial<RegPaceInput>): RegPaceInput => ({
  forecast: 100,
  current: 50,
  daysOpen: 5,
  daysLeft: 5,
  ...over,
});

describe("registrationPace", () => {
  it("crude linear expectation = forecast × daysOpen/(daysOpen+daysLeft)", () => {
    const r = registrationPace(inp({ forecast: 100, current: 50, daysOpen: 5, daysLeft: 5 }));
    expect(r.linearExpected).toBe(50); // halfway
    expect(r.gapVsLinear).toBe(0);
    expect(r.status).toBe("on-track");
    expect(r.pctOfForecast).toBe(50);
  });

  it("behind when meaningfully under the crude line", () => {
    const r = registrationPace(inp({ forecast: 100, current: 20, daysOpen: 5, daysLeft: 5 })); // line 50, at 20
    expect(r.status).toBe("behind");
    expect(r.headline).toMatch(/đang chậm/);
  });

  it("ahead when meaningfully over the crude line", () => {
    const r = registrationPace(inp({ forecast: 100, current: 80, daysOpen: 5, daysLeft: 5 }));
    expect(r.status).toBe("ahead");
  });

  it("within the ±10%-of-forecast band = on-track (not over-sensitive)", () => {
    const r = registrationPace(inp({ forecast: 100, current: 55, daysOpen: 5, daysLeft: 5 })); // line 50, gap +5 < band 10
    expect(r.status).toBe("on-track");
  });

  it("no forecast → unknown status, still shows the raw count", () => {
    const r = registrationPace(inp({ forecast: null, current: 38 }));
    expect(r.status).toBe("unknown");
    expect(r.available).toBe(false);
    expect(r.pctOfForecast).toBeNull();
    expect(r.headline).toMatch(/38 đăng ký/);
  });

  it("forecast present but no elapsed window (daysOpen+daysLeft=0) → unknown, but % of forecast still shown", () => {
    const r = registrationPace(inp({ forecast: 100, current: 30, daysOpen: 0, daysLeft: 0 }));
    expect(r.status).toBe("unknown");
    expect(r.pctOfForecast).toBe(30);
    expect(r.linearExpected).toBeNull();
  });

  it("always carries the back-loading caveat", () => {
    expect(registrationPace(inp({})).caveat).toMatch(/dồn ngày\/giờ chót/);
  });

  it("is deterministic", () => {
    const i = inp({ current: 42 });
    expect(registrationPace(i)).toEqual(registrationPace(i));
  });
});
