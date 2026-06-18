import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HandGuideDrawer } from "@/components/cashier/tournament-live/handinput/HandGuideDrawer";

describe("HandGuideDrawer (operator help)", () => {
  it("renders its own trigger button without throwing", () => {
    const html = renderToStaticMarkup(<HandGuideDrawer />);
    expect(html).toContain("Hướng dẫn nhập hand");
  });
});
