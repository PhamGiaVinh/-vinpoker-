export type TranscriptRiskTier = "EXACT" | "BOUNDED_REPAIR" | "REJECT";

export type TranscriptRepair =
  | {
      rule: "seat_prefix_fit_to_seat";
      from: "fit" | "feet";
      to: "seat";
    }
  | {
      rule: "gemini_million_punctuation_tail";
      from: string;
      to: string;
    }
  | {
      rule: "gemini_thousands_punctuation_tail";
      from: string;
      to: string;
    };

export interface HardenedTranscript {
  rawTranscript: string;
  normalizedTranscript: string;
  riskTier: TranscriptRiskTier;
  repairs: readonly TranscriptRepair[];
  requiresConfirmation: boolean;
  rejectReason?: "repair_budget_exceeded" | "repair_position_invalid";
}

const GEMINI_MILLION_PUNCTUATION_TAIL = /\b(\d{1,3})[.,](\d{3})[.,]0\b/g;
const GEMINI_THOUSANDS_PUNCTUATION_TAIL = /(?<![\d.,])(\d{3})\.0\b/g;

function normalizedGeminiMillionValue(millions: string, thousands: string): string {
  return `${millions}${thousands}000`;
}

function normalizedGeminiThousandsValue(thousands: string): string {
  return `${thousands}000`;
}

export function normalizeTrackerVoiceTranscript(value: string): string {
  const observedGeminiNumberNormalized = value.replace(
    GEMINI_MILLION_PUNCTUATION_TAIL,
    (_match, millions: string, thousands: string) => normalizedGeminiMillionValue(millions, thousands),
  );
  const thousandsNormalized = observedGeminiNumberNormalized.replace(/\b\d{1,3}(?:[.,]\d{3})+\b/g, (match) => match.replace(/[.,]/g, ""));
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

/** Accept at most one reviewed ASR repair and require confirmation for the result. */
export function hardenDealerTranscript(rawTranscript: string): HardenedTranscript {
  const amountRepairs: TranscriptRepair[] = [...rawTranscript.matchAll(GEMINI_MILLION_PUNCTUATION_TAIL)].map((match) => ({
    rule: "gemini_million_punctuation_tail",
    from: match[0],
    to: normalizedGeminiMillionValue(match[1], match[2]),
  }));
  amountRepairs.push(...[...rawTranscript.matchAll(GEMINI_THOUSANDS_PUNCTUATION_TAIL)].map((match) => ({
    rule: "gemini_thousands_punctuation_tail" as const,
    from: match[0],
    to: normalizedGeminiThousandsValue(match[1]),
  })));
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript.replace(
    GEMINI_THOUSANDS_PUNCTUATION_TAIL,
    (_match, thousands: string) => normalizedGeminiThousandsValue(thousands),
  ));
  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  const repairIndexes = tokens
    .map((token, index) => (token === "fit" || token === "feet" ? index : -1))
    .filter((index) => index >= 0);

  if (repairIndexes.length + amountRepairs.length >= 2) {
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
  if (amountRepairs.length === 1) {
    return {
      rawTranscript,
      normalizedTranscript,
      riskTier: "BOUNDED_REPAIR",
      repairs: amountRepairs,
      requiresConfirmation: true,
    };
  }
  return { rawTranscript, normalizedTranscript, riskTier: "EXACT", repairs: [], requiresConfirmation: false };
}
