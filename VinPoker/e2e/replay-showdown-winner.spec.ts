import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844, orientation: "portrait" },
  { name: "desktop", width: 1440, height: 900, orientation: "landscape" },
] as const;

for (const viewport of viewports) {
  test(`verified showdown is readable on ${viewport.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(
      `/__dev/livefelt?fixture=showdown&seats=3&orientation=${viewport.orientation}&viewerLayout=1&compact=1&tableFx=1&wrap=hub${viewport.name === "mobile" ? "&width=390" : ""}`,
      { waitUntil: "networkidle" },
    );

    await page.waitForTimeout(500);
    expect(pageErrors, consoleErrors.join("\n")).toEqual([]);
    await expect(page.locator("[data-dev-livefelt-preview]")).toBeVisible();
    await expect(page.getByTestId("seat-net-won")).toContainText("+7M");
    await expect(page.getByTestId("seat-hand-rank")).toContainText(/Cù lũ|Full house/);
    await expect(page.locator(".tracker-win-glow")).toHaveCount(2);
    expect(pageErrors).toEqual([]);
  });
}
