import { parseTrackerVoiceCommandCore } from "../../../src/lib/trackerVoice/parserCore.ts";
import type { TranscriptRepair } from "../../../src/lib/trackerVoice/transcriptHardener.ts";

export type TrackerVoiceCommandKind =
  | "fold"
  | "check"
  | "call"
  | "bet_to"
  | "raise_to"
  | "all_in"
  | "report_wrong_action"
  | "call_floor";

export interface TrackerVoiceParsedCommand {
  kind: TrackerVoiceCommandKind;
  normalizedTranscript: string;
  amount: number | null;
  amountAmbiguous: boolean;
  spokenSeatNumber: number | null;
  riskTier: "EXACT" | "BOUNDED_REPAIR";
  repairs: readonly TranscriptRepair[];
  requiresConfirmation: boolean;
}

/**
 * Server validation must classify exactly as the browser did. Legal action,
 * actor, and hand-state checks remain in the authoritative RPC path.
 */
export function parseTrackerVoiceCommand(
  transcript: string,
  options: { spokenAmountUnit: number; amountUnitConfirmed: boolean },
): TrackerVoiceParsedCommand | null {
  const parsed = parseTrackerVoiceCommandCore(transcript, options);
  if (!parsed) return null;
  return {
    kind: parsed.kind,
    normalizedTranscript: parsed.normalizedTranscript,
    amount: parsed.amount?.value ?? null,
    amountAmbiguous: parsed.amount?.ambiguous ?? false,
    spokenSeatNumber: parsed.spokenSeatNumber,
    riskTier: parsed.riskTier,
    repairs: parsed.repairs,
    requiresConfirmation: parsed.requiresConfirmation,
  };
}
