import { normalizeTrackerVoiceTranscript } from "./transcriptHardener";
import type { ParsedVoiceFinishCommand } from "./types";

/** Exact, whole-utterance grammar. Finish has no aliases or fuzzy repair. */
export function parseVoiceFinishCommand(rawTranscript: string): ParsedVoiceFinishCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(rawTranscript);
  if (normalizedTranscript !== "ket thuc hand") return null;
  return { kind: "finish_hand", rawTranscript, normalizedTranscript };
}
