import { describe, expect, it } from "vitest";
import {
  parseReplayTarget,
  replaceReplayTargetParams,
  replayTargetForHand,
  resolveReplayCandidates,
  toCanonicalReplayTarget,
  type ReplayCandidate,
} from "@/components/cashier/tournament-live/viewer-hub/replayTarget";

const oldHand8: ReplayCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  table_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hand_number: 8,
  status: "completed",
  is_voided: false,
};
const newHand1: ReplayCandidate = {
  id: "22222222-2222-4222-8222-222222222222",
  table_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  hand_number: 1,
  status: "completed",
  is_voided: false,
};
const oldHand1: ReplayCandidate = {
  id: "33333333-3333-4333-8333-333333333333",
  table_id: oldHand8.table_id,
  hand_number: 1,
  status: "completed",
  is_voided: false,
};

describe("stable replay target", () => {
  it("gives handId authority over the legacy hand number", () => {
    const target = parseReplayTarget(new URLSearchParams(`handId=${oldHand8.id}&tableId=${oldHand8.table_id}&hand=1`));
    expect(target).toEqual({ handId: oldHand8.id, tableId: oldHand8.table_id, handNumber: null });
    expect(resolveReplayCandidates(target!, [oldHand8, newHand1])).toEqual({
      kind: "resolved",
      handId: oldHand8.id,
      tableId: oldHand8.table_id,
      handNumber: 8,
    });
  });

  it("keeps Hand #8 on its historical table while a new table has Hand #1", () => {
    const resolved = resolveReplayCandidates({ handId: oldHand8.id, tableId: null, handNumber: null }, [newHand1, oldHand8]);
    expect(resolved).toMatchObject({ kind: "resolved", handId: oldHand8.id, tableId: oldHand8.table_id, handNumber: 8 });
  });

  it("rejects a UUID/table mismatch without falling back", () => {
    expect(resolveReplayCandidates({ handId: oldHand8.id, tableId: newHand1.table_id, handNumber: null }, [oldHand8])).toEqual({ kind: "mismatch" });
  });

  it("makes legacy duplicate hand numbers explicit", () => {
    expect(resolveReplayCandidates({ handId: null, tableId: null, handNumber: 1 }, [oldHand1, newHand1])).toEqual({ kind: "ambiguous" });
    expect(resolveReplayCandidates({ handId: null, tableId: oldHand8.table_id, handNumber: 1 }, [oldHand1, newHand1])).toMatchObject({
      kind: "resolved",
      handId: oldHand1.id,
    });
  });

  it("does not resolve missing, voided, or in-progress targets", () => {
    expect(resolveReplayCandidates({ handId: "missing", tableId: null, handNumber: null }, [oldHand8])).toEqual({ kind: "not_found" });
    expect(resolveReplayCandidates({ handId: oldHand8.id, tableId: null, handNumber: null }, [{ ...oldHand8, is_voided: true }])).toEqual({ kind: "not_found" });
    expect(resolveReplayCandidates({ handId: oldHand8.id, tableId: null, handNumber: null }, [{ ...oldHand8, status: "in_progress" }])).toEqual({ kind: "not_found" });
  });

  it("builds canonical links without preserving the ambiguous legacy number", () => {
    expect(toCanonicalReplayTarget({ handId: oldHand8.id, tableId: oldHand8.table_id, handNumber: 8 }).toString()).toBe(
      `handId=${oldHand8.id}&tableId=${oldHand8.table_id}`,
    );
  });

  it("converts a selected hand into a UUID-backed target", () => {
    expect(replayTargetForHand(oldHand8)).toEqual({
      handId: oldHand8.id,
      tableId: oldHand8.table_id,
      handNumber: oldHand8.hand_number,
    });
  });

  it("replaces the old URL target without preserving a legacy hand or post", () => {
    const next = replaceReplayTargetParams(
      new URLSearchParams(`tab=hands&handId=${oldHand1.id}&tableId=${oldHand1.table_id}&hand=1&post=story-1`),
      replayTargetForHand(oldHand8),
    );
    expect(next.toString()).toBe(`tab=hands&handId=${oldHand8.id}&tableId=${oldHand8.table_id}`);
  });
});
