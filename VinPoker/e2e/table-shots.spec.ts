// e2e/table-shots.spec.ts
// Visual harness — screenshots every poker-table state from the dev fixture route
// (/__dev/table, gated to import.meta.env.DEV) at mobile + desktop viewports. PNGs land in
// ./shots/ (gitignored). Run: `npm run shots`. Pure read/observe — never mutates the app.

import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// ESM project — resolve from cwd (Playwright runs from the project root).
const SHOTS = path.resolve(process.cwd(), 'shots');
const SEATS = [2, 6, 9] as const;
const PHASES = ['preflop', 'flop', 'river', 'showdown'] as const;
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

async function settleAndShoot(page: Page, name: string, settleMs: number) {
  await page.waitForSelector('[data-dev-table-preview]', { timeout: 15_000 });
  await page.waitForTimeout(settleMs); // let the felt / pulses / cinematic reach a frame
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const seats of SEATS) {
      for (const phase of PHASES) {
        test(`seats${seats}_${phase}`, async ({ page }) => {
          await page.goto(`/__dev/table?seats=${seats}&phase=${phase}&allin=0`);
          await settleAndShoot(page, `${vp.name}_seats${seats}_${phase}`, 500);
        });
      }
      // one all-in cinematic per seat count (frame captured mid-runout)
      test(`seats${seats}_allin`, async ({ page }) => {
        await page.goto(`/__dev/table?seats=${seats}&phase=showdown&allin=1`);
        await settleAndShoot(page, `${vp.name}_seats${seats}_allin`, 1300);
      });
    }

    // OFF-TURN state (toAct = an opponent) — confirms the action dock disappears off-turn
    // (N8 behaviour) and the felt isn't broken. One representative 6-max flop is enough.
    test('seats6_flop_offturn', async ({ page }) => {
      await page.goto('/__dev/table?seats=6&phase=flop&allin=0&toAct=2');
      await settleAndShoot(page, `${vp.name}_seats6_flop_offturn`, 500);
    });
  });
}
