import { parseSpokenAmount } from "./amount";
import type { ParsedVoiceCommand, VoiceCommandKind } from "./types";

function normalizeTranscript(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[!?;:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMMANDS: Array<{ kind: VoiceCommandKind; pattern: RegExp }> = [
  { kind: "report_wrong_action", pattern: /\b(bao sai|sai action|wrong action|action sai)\b/ },
  { kind: "call_floor", pattern: /\b(goi floor|call floor|floor oi|can floor)\b/ },
  { kind: "all_in", pattern: /\b(all[ -]?in|tat tay|tat ca)\b/ },
  { kind: "raise_to", pattern: /\b(raise(?: to)?|to len|nang(?: len| to)?)\b/ },
  { kind: "bet_to", pattern: /\b(bet(?: to)?|cuoc(?: den| len)?)\b/ },
  { kind: "call", pattern: /\b(call|theo|theo bai)\b/ },
  { kind: "check", pattern: /\b(check|xem|qua|check bai)\b/ },
  { kind: "fold", pattern: /\b(fold|up bai|bo bai|bo)\b/ },
];

export function parseVoiceCommand(
  transcript: string,
  options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean } = {},
): ParsedVoiceCommand | null {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) return null;
  const matched = COMMANDS.find(({ pattern }) => pattern.test(normalizedTranscript));
  if (!matched) return null;

  const amount = matched.kind === "bet_to" || matched.kind === "raise_to"
    ? parseSpokenAmount(normalizedTranscript, options)
    : null;

  return {
    kind: matched.kind,
    transcript: transcript.trim(),
    normalizedTranscript,
    amount,
  };
}
