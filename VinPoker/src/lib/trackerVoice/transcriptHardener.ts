export type TranscriptRiskTier = "EXACT" | "BOUNDED_REPAIR" | "REJECT";

export interface TranscriptRepair {
  rule: "seat_prefix_fit_to_seat";
  from: "fit" | "feet";
  to: "seat";
}

export interface HardenedTranscript {
  rawTranscript: string;
  normalizedTranscript: string;
  riskTier: TranscriptRiskTier;
  repairs: readonly TranscriptRepair[];
  requiresConfirmation: boolean;
  rejectReason?: "repair_budget_exceeded" | "repair_position_invalid";
}

export function normalizeTrackerVoiceTranscript(value: string): string {
  const thousandsNormalized = value.replace(/\b\d{1,3}(?:[.,]\d{3})+\b/g, (match) => match.replace(/[.,]/g, ""));
  return thousandsNormalized
    .trim()
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/[!?;:,]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEAT_TOKEN = /^(?:[1-9]|10|one|two|three|four|five|six|seven|eight|nine|ten|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi)$/;

/** One limited repair keeps a known ASR prefix from becoming an unqualified poker action. */
export function hardenDealerTranscript(rawTranscript: string): HardenedTranscript {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  const repairIndexes = tokens
    .map((token, index) => (token === "fit" || token === "feet" ? index : -1))
    .filter((index) => index >= 0);

  if (repairIndexes.length >= 2) {
    return { rawTranscript, normalizedTranscript, riskTier: "REJECT", repairs: [], requiresConfirmation: true, rejectReason: "repair_budget_exceeded" };
  }
  if (repairIndexes.length === 1) {
    const index = repairIndexes[0];
    const token = tokens[index] as "fit" | "feet";
    if (index !== 0 || !SEAT_TOKEN.test(tokens[1] ?? "")) {
      return { rawTranscript, normalizedTranscript, riskTier: "REJECT", repairs: [], requiresConfirmation: true, rejectReason: "repair_position_invalid" };
    }
    tokens[0] = "seat";
    return {
      rawTranscript,
      normalizedTranscript: tokens.join(" "),
      riskTier: "BOUNDED_REPAIR",
      repairs: [{ rule: "seat_prefix_fit_to_seat", from: token, to: "seat" }],
      requiresConfirmation: true,
    };
  }
  return { rawTranscript, normalizedTranscript, riskTier: "EXACT", repairs: [], requiresConfirmation: false };
}
