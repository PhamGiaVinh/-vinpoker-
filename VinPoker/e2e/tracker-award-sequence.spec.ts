import { expect, test } from "@playwright/test";

test.use({ video: "on" });

for (const width of [390, 1440]) {
  test(`verified pots credit stacks and play the original cue at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      const sounds: HTMLMediaElement[] = [];
      Object.assign(window, { awardTestSounds: sounds });
      HTMLMediaElement.prototype.play = function () {
        if (this.src.includes("pot-award.mp3")) sounds.push(this);
        return original.call(this);
      };
    });
    await page.goto(`/__dev/livefelt?fixture=verified-sidepots&play=1&autoplay=0&orientation=${width < 640 ? "portrait" : "landscape"}&wrap=console`);
    await page.getByTitle(/^(Phát|Play)$/).click();
    const main = page.getByTestId("felt-settlement-award-label-tom");
    await expect(main).toHaveText("+150 BB", { timeout: 20_000 });
    const mainAppearedAt = Date.now();
    await expect(page.getByTestId("felt-stack-tom")).toHaveText("150 BB");
    await expect(page.getByTestId("felt-stack-phil")).toHaveText("0 BB");
    await expect.poll(() => page.evaluate(() => {
      const sounds = (window as unknown as { awardTestSounds: HTMLMediaElement[] }).awardTestSounds;
      return sounds.some(sound => sound.currentTime > 0.1 && sound.duration > 1.6 && !sound.error);
    })).toBe(true);
    await page.screenshot({ path: `shots/award-main-${width}.png`, fullPage: true });
    const side = page.getByTestId("felt-settlement-award-label-phil");
    await expect(side).toHaveText("+50 BB");
    expect(Date.now() - mainAppearedAt).toBeGreaterThan(2_800);
    await expect(page.getByTestId("felt-stack-tom")).toHaveText("150 BB");
    await expect(page.getByTestId("felt-stack-phil")).toHaveText("50 BB");
    await expect.poll(() => page.evaluate(() => (window as unknown as { awardTestSounds: HTMLMediaElement[] }).awardTestSounds.length)).toBe(2);
    await page.waitForTimeout(3_200);
    await expect(side).toBeVisible();
    await expect(page.locator('[data-testid^="felt-settlement-pot-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="felt-settlement-pot-"]')).not.toContainText("{{");
    await page.screenshot({ path: `shots/award-side-${width}.png`, fullPage: true });
    const stack = await page.getByTestId("felt-stack-phil").boundingBox();
    const label = await side.boundingBox();
    expect(label!.y).toBeGreaterThanOrEqual(stack!.y + stack!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("fold win credits only the pot, keeps cards hidden, and mute suppresses the cue", async ({ page }) => {
  let awards = 0;
  page.on("request", request => { if (request.url().includes("pot-award.mp3")) awards++; });
  await page.goto("/__dev/livefelt?fixture=verified-fold&play=1&autoplay=0&orientation=portrait");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await page.getByTitle(/^(Phát|Play)$/).click();
  await expect(page.getByTestId("felt-settlement-award-label-phil")).toHaveText("+2 BB", { timeout: 15_000 });
  await expect(page.getByTestId("felt-stack-phil")).toHaveText("76 BB");
  await expect(page.locator('[data-testid="seat-holecards"] [data-card-code]')).toHaveCount(0);
  await expect(page.locator(".tracker-best-five-card")).toHaveCount(0);
  expect(awards).toBe(0);
});
