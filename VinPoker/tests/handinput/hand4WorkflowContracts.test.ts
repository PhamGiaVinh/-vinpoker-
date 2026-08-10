import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Hand #4 resume workflow contracts", () => {
  it("commits the persisted hand identity and only announces a successful resume", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    expect(source).toContain('.select("id, hand_number, table_id, button_seat, community_cards")');
    expect(source).toContain("setHandNumber(Number(hand.hand_number))");
    expect(source).toContain("if (!resumed) return;");
    expect(source).toContain("loadNextHandNumber: false");
  });

  it("keeps cashier re-entry, registration VOID, and Tracker flags fail-closed", () => {
    expect(FEATURES.cashierReentry).toBe(false);
    expect(FEATURES.registrationExtensions).toBe(false);
    expect(FEATURES.trackerUnifiedOpsFlow).toBe(false);
    expect(FEATURES.trackerAtomicResettle).toBe(false);

    const reentry = read("src/components/cashier/ReentryPanel.tsx");
    const queue = read("src/components/cashier/tournament-live/RegistrationQueuePanel.tsx");
    expect(reentry).toContain("FEATURES.cashierReentry");
    expect(reentry).not.toContain("FEATURES.registrationExtensions");
    expect(queue).toContain("FEATURES.registrationExtensions");
  });

  it("signals React boot before the animation frame used for splash cleanup", () => {
    const source = read("src/main.tsx");
    const mounted = source.indexOf('window.dispatchEvent(new Event("vp:react-mounted"))');
    const frame = source.indexOf("requestAnimationFrame(() => {");
    expect(mounted).toBeGreaterThan(-1);
    expect(mounted).toBeLessThan(frame);
    expect(source.slice(frame)).not.toContain('window.dispatchEvent(new Event("vp:react-mounted"))');
  });
});
