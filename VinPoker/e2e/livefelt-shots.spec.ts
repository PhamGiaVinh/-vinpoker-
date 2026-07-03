// e2e/livefelt-shots.spec.ts
// Tracker LiveFelt measurement harness — screenshots + NUMERIC geometry metrics from
// the dev fixture route (/__dev/livefelt, import.meta.env.DEV-gated). PNGs land in
// ./shots/ (gitignored); metrics land in ./shots/livefelt-metrics.json. The committed
// reference lives at e2e/baselines/livefelt-baseline.json (copied there when a new
// baseline is intentionally cut). Run: `npm run shots:livefelt`.
// Pure read/observe — never mutates the app. Measurements are DOM-numeric (immune to
// animation flake); screenshots use fixed settle waits like table-shots.

import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.resolve(process.cwd(), 'shots');
const METRICS_FILE = path.join(SHOTS, 'livefelt-metrics.json');

const VIEWPORTS = [
  { name: 'p390', width: 390, height: 844, orientation: 'portrait' },
  { name: 'l844', width: 844, height: 390, orientation: 'landscape' },
  { name: 'd1280', width: 1280, height: 900, orientation: 'landscape' },
  { name: 'd1600', width: 1600, height: 900, orientation: 'landscape' },
] as const;
const WRAPS = ['plain', 'console', 'hub'] as const;
const FIXTURES = ['showdown', 'allin-sidepots'] as const;
const SEATS = 9; // owner-complaint density; pod-count sanity checks against this

interface CaseMetrics {
  case: string;
  dpr: number;
  selectorConfidence: { ovalCount: number; podCount: number; expectedPods: number; ok: boolean };
  felt: { w: number; h: number; left: number; top: number; maxWExpected: number; bypass: boolean } | null;
  pods: { seat: string; x: number; y: number; w: number; h: number; ratio: number }[];
  podFeltRatioAvg: number | null;
  topRowOverhangPx: number | null;
  bottomRowEndDistancePx: number | null;
  overlaps: { podPod: number; podStatusBar: number; podActionRail: number };
  cards: { boardW: number | null; holeW: number | null };
}

const all: CaseMetrics[] = [];

test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });
test.afterAll(() => {
  fs.writeFileSync(METRICS_FILE, JSON.stringify({ generatedAt: 'baseline-run', seats: SEATS, cases: all }, null, 2));
});

async function measure(page: Page, caseName: string, expectedPods: number, maxWExpected: number): Promise<CaseMetrics> {
  const m = await page.evaluate(({ expectedPods, maxWExpected }) => {
    const root = document.querySelector('[data-dev-livefelt-preview]');
    if (!root) return null;
    // The oval = the aspect-ratio container that holds the felt layers. Cards also carry
    // aspect-ratio inline, so require the oval's OWN signature: maxWidth (default branch)
    // or a scale transform (narrow-landscape fit branch).
    const ovals = [...root.querySelectorAll('div')].filter((d) => {
      const el = d as HTMLElement;
      return el.style.aspectRatio && (el.style.maxWidth || el.style.transform.includes('scale'));
    });
    const oval = ovals[0] as HTMLElement | undefined;
    // Pods = LiveFelt's seat wrappers: absolute z-10 divs INSIDE the oval.
    const pods = oval ? [...oval.querySelectorAll(':scope > div.absolute.z-10')] as HTMLElement[] : [];
    const or = oval?.getBoundingClientRect();
    const podRects = pods.map((p) => {
      const r = p.getBoundingClientRect();
      const name = p.querySelector('.tracker-display.truncate, .tracker-display.max-w-full')?.textContent?.trim() ?? '?';
      return { seat: name, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
    });
    // Overlap helper (>4px on both axes counts).
    const inter = (a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: DOMRect) => {
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return ox > 4 && oy > 4;
    };
    let podPod = 0;
    const rawRects = pods.map((p) => p.getBoundingClientRect());
    for (let i = 0; i < rawRects.length; i++) for (let j = i + 1; j < rawRects.length; j++) if (inter(rawRects[i], rawRects[j])) podPod++;
    const statusBar = root.querySelector('[data-testid="felt-status-bar"]')?.getBoundingClientRect() ?? null;
    // Action rail = the "Hành động" pill under the felt.
    const railLabel = [...root.querySelectorAll('span')].find((s) => /Hành động/i.test(s.textContent || ''));
    const rail = railLabel?.closest('div')?.getBoundingClientRect() ?? null;
    let podStatusBar = 0, podActionRail = 0;
    for (const r of rawRects) {
      if (statusBar && inter(statusBar, r as DOMRect)) podStatusBar++;
      if (rail && inter(rail, r as DOMRect)) podActionRail++;
    }
    // Rim overhang: top-row pods (cy above oval centre) — px their top edge sits ABOVE the oval top.
    let topOverhang: number | null = null;
    let bottomEndDist: number | null = null;
    if (or) {
      const tops = podRects.filter((p) => p.cy < or.top + or.height / 2);
      if (tops.length) topOverhang = Math.max(...tops.map((p) => Math.round(or.top - p.y)));
      // Stadium rounded-end centres: (left + R, cy) / (right − R, cy), R = height/2.
      const R = or.height / 2;
      const endL = or.left + R, endR = or.right - R;
      const bottoms = podRects.filter((p) => p.cy > or.top + or.height * 0.7);
      if (bottoms.length) bottomEndDist = Math.round(Math.min(...bottoms.map((p) => Math.min(Math.abs(p.cx - endL), Math.abs(p.cx - endR)))));
    }
    const boardCard = root.querySelector('[data-testid="board-cards"] > *') as HTMLElement | null;
    const holeCard = root.querySelector('[data-testid="seat-holecards"] > *') as HTMLElement | null;
    const feltW = or ? Math.round(or.width) : 0;
    return {
      dpr: window.devicePixelRatio,
      selectorConfidence: { ovalCount: ovals.length, podCount: pods.length, expectedPods, ok: ovals.length === 1 && pods.length === expectedPods },
      felt: or ? { w: feltW, h: Math.round(or.height), left: Math.round(or.left), top: Math.round(or.top), maxWExpected, bypass: feltW > maxWExpected + 1 } : null,
      pods: podRects.map(({ seat, x, y, w, h }) => ({ seat, x, y, w, h, ratio: feltW ? +(w / feltW * 100).toFixed(2) : 0 })),
      podFeltRatioAvg: podRects.length && feltW ? +(podRects.reduce((s, p) => s + p.w, 0) / podRects.length / feltW * 100).toFixed(2) : null,
      topRowOverhangPx: topOverhang,
      bottomRowEndDistancePx: bottomEndDist,
      overlaps: { podPod, podStatusBar, podActionRail },
      cards: { boardW: boardCard ? Math.round(boardCard.getBoundingClientRect().width) : null, holeW: holeCard ? Math.round(holeCard.getBoundingClientRect().width) : null },
    };
  }, { expectedPods, maxWExpected });
  if (!m) throw new Error(`measure(): harness root not found for ${caseName}`);
  return { case: caseName, ...m } as CaseMetrics;
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const wrap of WRAPS) {
      for (const fixture of FIXTURES) {
        test(`${wrap}_${fixture}`, async ({ page }) => {
          await page.goto(`/__dev/livefelt?fixture=${fixture}&seats=${SEATS}&orientation=${vp.orientation}&wrap=${wrap}`);
          await page.waitForSelector('[data-dev-livefelt-preview]', { timeout: 15_000 });
          await page.waitForTimeout(600); // fonts + entrance animations settle
          // Expected maxW: compact portrait stadium 480; V2 landscape 880 (viewerLayout+compact defaults on).
          const maxW = vp.orientation === 'portrait' ? 480 : 880;
          const metrics = await measure(page, `${vp.name}_${wrap}_${fixture}`, SEATS, maxW);
          all.push(metrics);
          await page.screenshot({ path: path.join(SHOTS, `livefelt_${vp.name}_${wrap}_${fixture}.png`) });
        });
      }
    }
  });
}

// Width sweep — empirically probes maxW behavior far past the cap (owner saw ~1400px).
test.describe('width-sweep', () => {
  test.use({ viewport: { width: 1650, height: 950 } });
  for (const w of [560, 820, 880, 1200, 1400]) {
    test(`sweep_${w}`, async ({ page }) => {
      await page.goto(`/__dev/livefelt?fixture=allin-sidepots&seats=${SEATS}&orientation=landscape&wrap=plain&width=${w}`);
      await page.waitForSelector('[data-dev-livefelt-preview]', { timeout: 15_000 });
      await page.waitForTimeout(400);
      const metrics = await measure(page, `sweep_w${w}`, SEATS, 880);
      all.push(metrics);
      await page.screenshot({ path: path.join(SHOTS, `livefelt_sweep_${w}.png`) });
    });
  }
});
