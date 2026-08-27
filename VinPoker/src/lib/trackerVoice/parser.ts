import { parseTrackerVoiceCommandCore } from "./parserCore";
import type { ParsedVoiceCommand } from "./types";

/**
 * Keep the public browser shape stable while using the shared parser core.
 */
export function parseVoiceCommand(
  transcript: string,
  options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean } = {},
): ParsedVoiceCommand | null {
  const parsed = parseTrackerVoiceCommandCore(transcript, options);
  if (!parsed) return null;
  return {
    kind: parsed.kind,
    transcript: transcript.trim(),
    normalizedTranscript: parsed.normalizedTranscript,
    amount: parsed.amount,
    spokenSeatNumber: parsed.spokenSeatNumber,
    riskTier: parsed.riskTier,
    repairs: parsed.repairs,
    requiresConfirmation: parsed.requiresConfirmation,
  };
}
