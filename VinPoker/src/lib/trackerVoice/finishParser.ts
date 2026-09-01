import { normalizeTrackerVoiceTranscript } from "./transcriptHardener.ts";
import type { ParsedVoiceFinishCommand } from "./types.ts";

/** Exact, whole-utterance grammar. Finish has no aliases or fuzzy repair. */
export function parseVoiceFinishCommand(rawTranscript: string): ParsedVoiceFinishCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  if (normalizedTranscript !== "ket thuc hand") return null;
  return { kind: "finish_hand", rawTranscript, normalizedTranscript };
}
