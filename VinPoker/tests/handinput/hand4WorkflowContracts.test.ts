import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Hand #4 resume workflow contracts", () => {
  it("distinguishes manual ending-stack edits from engine settlement", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const auto = source.slice(source.indexOf("const handleAutoSettle ="), source.indexOf("const handleConfirmShowdownResult ="));
    const manual = source.slice(source.indexOf("const handleConfirmShowdownResult ="), source.indexOf("const handleSubmitHand ="));
    const fold = source.slice(source.indexOf("const winner = foldWinner(engineState.seats);"));
    expect(auto).toContain("setEndingStacksManuallyEdited(false)");
    expect(manual.match(/setEndingStacksManuallyEdited\(true\)/g)).toHaveLength(2);
    expect(fold).toContain("setEndingStacksManuallyEdited(false)");
    expect(source).toContain("if (endingStacksManuallyEdited && !confirm(");
    expect(source).not.toContain("const stacksEdited = players.some(");
  });

  it("commits the persisted hand identity and only announces a successful resume", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    expect(source).toContain('.select("id, hand_number, table_id, button_seat, community_cards")');
    expect(source).toContain("setHandNumber(Number(hand.hand_number))");
    expect(source).toContain("if (!resumed) return;");
    expect(source).toContain("loadNextHandNumber: false");
  });

  it("restores the previous persisted BB before suggesting the next button", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const tableLoad = source.slice(source.indexOf("const handleTableChange ="), source.indexOf("const handlePickTable ="));

    expect(tableLoad).toContain('.select("id, button_seat")');
    expect(tableLoad).toContain('.eq("action_type", "post_bb")');
    expect(tableLoad).toContain('.from("hand_players")');
    expect(tableLoad).toContain("previousBbSeat = lastBbPlayer?.seat_number ?? null");
    expect(tableLoad).toContain("setLastBbSeat(previousBbSeat)");
    expect(tableLoad).toContain("prevBbSeat: previousBbSeat");
  });

  it("reconciles an uncertain hand submit by exact readback without retrying the writer", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const submit = source.slice(source.indexOf("const handleSubmitHand ="), source.indexOf("const handleVoid ="));

    expect(submit.match(/supabase\.functions\.invoke\("tournament-live-update"/g)).toHaveLength(1);
    expect(submit).toContain('.from("tournament_hands")');
    expect(submit).toContain('.eq("id", submittedHandId)');
    expect(submit).toContain('.eq("tournament_id", tournamentId)');
    expect(submit).toContain('.eq("table_id", tableId)');
    expect(submit).toContain('.eq("hand_number", Number(handNumber))');
    expect(submit).toContain("isConfirmedCompletedHandReadback(completedHand, potSize)");
    expect(submit).toContain("await applyRecordedHand(completedHand.id, true)");
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
