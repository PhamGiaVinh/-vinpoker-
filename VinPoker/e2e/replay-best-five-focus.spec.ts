import { expect, test, type Page } from "@playwright/test";

const GOLDEN_CODES = ["Jd", "Jh", "Jc", "Js", "Ah"] as const;
const DIMMED_CODES = ["Kh", "Qh", "Qd", "As"] as const;

async function openFixture(
  page: Page,
  fixture: "best-five-quads" | "board-plays" | "chop",
  orientation: "portrait" | "landscape",
) {
  await page.goto(`/__dev/livefelt?fixture=${fixture}&seats=3&orientation=${orientation}&wrap=hub`);
  await page.waitForSelector(".tracker-best-five-focus-active");
  await page.waitForTimeout(600);
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844, orientation: "portrait" as const },
  { name: "tablet", width: 834, height: 1112, orientation: "portrait" as const },
  { name: "desktop", width: 1440, height: 900, orientation: "landscape" as const },
]) {
  test(`Hand #1 exact best five stays stable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFixture(page, "best-five-quads", viewport.orientation);

    await expect(page.locator(".tracker-best-five-card")).toHaveCount(5);
    for (const code of GOLDEN_CODES) {
      await expect(page.locator(`[data-card-code="${code}"].tracker-best-five-card`)).toHaveCount(1);
    }
    for (const code of DIMMED_CODES) {
      await expect(page.locator(`[data-card-code="${code}"].tracker-non-best-five-card`)).toHaveCount(1);
    }

    await expect(page.locator('[data-testid="seat-holecards"].tracker-win-glow')).toHaveCount(0);
    await expect(page.locator(".tracker-win-glow")).toHaveCount(1);
    await expect(page.locator(".tracker-best-five-focus-active")).not.toContainText(/Thắng pot|quads|Kicker|Hoàn|Bộ 5 lá/i);
    await expect(page.locator(".tracker-best-five-focus-active")).toContainText("20k");

    const first = await page.locator(".tracker-best-five-card").evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    }));
    await page.waitForTimeout(250);
    const second = await page.locator(".tracker-best-five-card").evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    }));
    expect(second).toEqual(first);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("board-plays focuses the board and dims both winner hole cards", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await openFixture(page, "board-plays", "portrait");
  await expect(page.locator('[data-testid="board-cards"] .tracker-best-five-card')).toHaveCount(5);
  await expect(page.locator('[data-testid="seat-holecards"] .tracker-best-five-card')).toHaveCount(0);
  await expect(page.locator('[data-testid="seat-holecards"] .tracker-non-best-five-card')).toHaveCount(4);
  await expect(page.locator(".tracker-win-glow")).toHaveCount(1);
});

test("chop focuses the shared board and keeps both verified winner avatars", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, "chop", "portrait");
  await expect(page.locator('[data-testid="board-cards"] .tracker-best-five-card')).toHaveCount(5);
  await expect(page.locator('[data-testid="seat-holecards"] .tracker-non-best-five-card')).toHaveCount(4);
  await expect(page.locator(".tracker-win-glow")).toHaveCount(2);
});

test("reduced motion keeps static focus while removing transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, "best-five-quads", "portrait");
  const style = await page.locator(".tracker-best-five-card").first().evaluate((card) => {
    const computed = getComputedStyle(card);
    return { outlineStyle: computed.outlineStyle, transitionDuration: computed.transitionDuration };
  });
  expect(style.outlineStyle).toBe("solid");
  expect(style.transitionDuration).toBe("0s");
});
