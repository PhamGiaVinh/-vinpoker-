// Drift guard: the Edge copy of the payout engine (supabase/functions/_shared/*) MUST stay identical
// to the canonical client engine (src/lib/*). If they diverge, the official server compute and the
// client preview would disagree and operators would lose trust. This test fails loudly on any drift.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as clientEngine from "./payoutEngine";
import * as sharedEngine from "../../supabase/functions/_shared/payoutEngine";
import { ALPHA as CLIENT_ALPHA, ALPHA_VERSION as CLIENT_AV, ALPHA_MAX_N as CLIENT_MAXN, type PayoutArchetype } from "./payoutEngineAlpha";
import { ALPHA as SHARED_ALPHA, ALPHA_VERSION as SHARED_AV, ALPHA_MAX_N as SHARED_MAXN } from "../../supabase/functions/_shared/payoutEngineAlpha";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

const clientEngineSrc = read("./payoutEngine.ts");
const sharedEngineSrc = read("../../supabase/functions/_shared/payoutEngine.ts");
const clientAlphaSrc = read("./payoutEngineAlpha.ts");
const sharedAlphaSrc = read("../../supabase/functions/_shared/payoutEngineAlpha.ts");

// The ONLY intended source difference: the Edge copy needs the explicit Deno import extension.
const normalize = (s: string) => s.replace('from "./payoutEngineAlpha.ts"', 'from "./payoutEngineAlpha"');

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

describe("payout engine drift guard — Edge _shared copy vs canonical client", () => {
  it("payoutEngineAlpha.ts is BYTE-IDENTICAL (generated table, no imports)", () => {
    expect(sharedAlphaSrc).toBe(clientAlphaSrc);
  });

  it("payoutEngine.ts logic is identical except the alpha-import extension", () => {
    expect(normalize(sharedEngineSrc)).toBe(clientEngineSrc);
  });

  it("ALPHA table is deep-equal, same length per archetype, same hash + ALPHA_VERSION", () => {
    expect(SHARED_AV).toBe(CLIENT_AV);
    expect(SHARED_MAXN).toBe(CLIENT_MAXN);
    const arches: PayoutArchetype[] = ["DAILY", "INTL", "MULTI", "TRITON"];
    for (const a of arches) {
      expect(SHARED_ALPHA[a].length).toBe(CLIENT_ALPHA[a].length);
      expect(SHARED_ALPHA[a].length).toBe(CLIENT_MAXN + 1); // index 0 placeholder + N=1..MAXN
    }
    expect(djb2(JSON.stringify(SHARED_ALPHA))).toBe(djb2(JSON.stringify(CLIENT_ALPHA)));
    expect(SHARED_ALPHA).toEqual(CLIENT_ALPHA);
  });

  it("ENGINE_VERSION matches between the two engines", () => {
    expect((sharedEngine as typeof clientEngine).ENGINE_VERSION).toBe(clientEngine.ENGINE_VERSION);
    const fromSrc = (s: string) => s.match(/ENGINE_VERSION\s*=\s*"([^"]+)"/)?.[1];
    expect(fromSrc(sharedEngineSrc)).toBe(fromSrc(clientEngineSrc));
    expect(fromSrc(clientEngineSrc)).toBe(clientEngine.ENGINE_VERSION);
  });

  it("both engines return IDENTICAL output across a matrix (archetypes × N × edge cases)", () => {
    const M = 1_000_000;
    const arches: PayoutArchetype[] = ["DAILY", "INTL", "MULTI", "TRITON"];
    const matrix: clientEngine.PayoutInput[] = [];

    // golden 82-entry DAILY
    matrix.push({ entries: 82, prizePool: 82 * M, floor: 2.4 * M, itmPercent: 0.125, archetype: "DAILY", roundingUnit: 100_000 });
    // N small (1 and 2)
    matrix.push({ entries: 10, prizePool: 12 * M, floor: 2.4 * M, itmPercent: 0.05, archetype: "INTL", roundingUnit: 100_000 }); // N=1
    matrix.push({ entries: 14, prizePool: 14 * M, floor: 2.4 * M, itmPercent: 0.1, archetype: "MULTI", roundingUnit: 100_000 }); // N=2
    // pool < floor
    matrix.push({ entries: 3, prizePool: 2 * M, floor: 2.4 * M, itmPercent: 0.34, archetype: "DAILY", roundingUnit: 100_000 });
    // pool == N×floor
    matrix.push({ entries: 5, prizePool: 10 * M, floor: 2 * M, itmPercent: 1.0, archetype: "DAILY", roundingUnit: 100_000 });
    // rounding repair (ROUNDING_ADJUSTED)
    matrix.push({ entries: 5, prizePool: 8 * M, floor: 2.4 * M, itmPercent: 0.5, archetype: "DAILY", roundingUnit: 1_000_000 });
    // N > 450
    matrix.push({ entries: 4000, prizePool: 4000 * M, floor: 2.4 * M, itmPercent: 0.15, archetype: "DAILY", roundingUnit: 1_000_000 });
    // each archetype at small/medium/high N
    for (const a of arches) {
      const minCashX = a === "MULTI" ? 1.5 : a === "TRITON" ? 1.6 : 2;
      for (const entries of [30, 200, 777, 1500]) {
        for (const itm of [0.1, 0.125, 0.15, 0.18]) {
          for (const buyIn of [600_000, 1_000_000, 2_000_000]) {
            matrix.push({
              entries,
              prizePool: entries * buyIn,
              floor: minCashX * (buyIn + Math.round(buyIn * 0.2)),
              itmPercent: itm,
              archetype: a,
              roundingUnit: buyIn < 2_000_000 ? 100_000 : 1_000_000,
            });
          }
        }
      }
    }

    for (const input of matrix) {
      const c = clientEngine.computePayouts(input);
      const s = (sharedEngine as typeof clientEngine).computePayouts(input);
      expect(s.rows).toEqual(c.rows);
      expect(s.tiers).toEqual(c.tiers);
      expect(s.warnings).toEqual(c.warnings);
      expect(s.itmPlaces).toBe(c.itmPlaces);
      expect(s.effectiveFloor).toBe(c.effectiveFloor);
      expect(s.prizePool).toBe(c.prizePool);
      expect(s.engineVersion).toBe(c.engineVersion);
      expect(s.alphaVersion).toBe(c.alphaVersion);
    }
    expect(matrix.length).toBeGreaterThan(150);
  });
});
