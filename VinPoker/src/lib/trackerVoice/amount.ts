import { parseTrackerVoiceAmount } from "./parserCore";
import type { ParsedVoiceAmount } from "./types";

/**
 * Browser compatibility wrapper. The implementation lives in parserCore so
 * the browser and Edge validate the same spoken amounts.
 */
export function parseSpokenAmount(
  rawInput: string,
  options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean } = {},
): ParsedVoiceAmount {
  return parseTrackerVoiceAmount(rawInput, options);
}
