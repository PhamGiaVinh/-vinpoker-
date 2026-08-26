import { expect, test } from "@playwright/test";

test.describe("Center Point Poker Masters public route", () => {
  test("renders the event experience and supports the main local interactions", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/center-point-poker-masters");
    await expect(page.getByRole("heading", { name: /poker masters/i, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /upcoming events/i })).toBeVisible();

    await page.getByRole("button", { name: /register now/i }).first().click();
    await expect(page.getByRole("dialog")).toContainText(/register for season 3/i);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.getByRole("button", { name: /view schedule/i }).click();
    await expect(page.getByRole("heading", { name: /upcoming events/i })).toBeInViewport();
    await page.getByRole("button", { name: /view details/i }).first().click();
    await expect(page.getByRole("dialog")).toContainText(/kick off event/i);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /early bird registration/i }).click();
    await expect(page.getByRole("dialog")).toContainText(/early bird registration/i);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /subscribe/i }).click();
    await expect(page.getByRole("alert")).toContainText(/valid email/i);
    await page.getByLabel("Email address").fill("player@example.test");
    await page.getByRole("button", { name: /subscribe/i }).click();
    await expect(page.getByRole("status")).toContainText(/subscription confirmed locally/i);
    expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test("uses a working mobile menu without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/center-point-poker-masters");
    await page.getByRole("button", { name: /open navigation menu/i }).click();
    await expect(page.getByRole("navigation", { name: /mobile navigation/i })).toBeVisible();
    await page.getByRole("navigation", { name: /mobile navigation/i }).getByRole("button", { name: "Events" }).click();
    await expect(page.getByRole("heading", { name: /upcoming events/i })).toBeInViewport();
    expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});
