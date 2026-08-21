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
}

function normalize(value: string): string {
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

const COMMANDS: Array<{ kind: TrackerVoiceCommandKind; pattern: RegExp }> = [
  { kind: "report_wrong_action", pattern: /\b(bao sai|sai action|wrong action|action sai)\b/ },
  { kind: "call_floor", pattern: /\b(goi floor|call floor|floor oi|can floor)\b/ },
  { kind: "all_in", pattern: /\b(all[ -]?in|tat tay|tat ca)\b/ },
  { kind: "raise_to", pattern: /\b(raise(?: to)?|to len|nang(?: len| to)?)\b/ },
  { kind: "bet_to", pattern: /\b(bet(?: to)?|cuoc(?: den| len)?)\b/ },
  { kind: "call", pattern: /\b(call|theo|theo bai)\b/ },
  { kind: "check", pattern: /\b(check|xem|qua|check bai)\b/ },
  { kind: "fold", pattern: /\b(fold|up bai|bo bai|bo)\b/ },
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
  muoi: 10,
};

function parseAmount(
  transcript: string,
  spokenAmountUnit: number,
  amountUnitConfirmed: boolean,
): { value: number | null; ambiguous: boolean } {
  const numeric = transcript.match(/\b(\d+(?:[.,]\d+)?)\s*(k|m|nghin|ngan|trieu|thousand|million)?\b/);
  if (numeric) {
    const base = Number(numeric[1].replace(",", "."));
    if (!Number.isFinite(base) || base < 0) return { value: null, ambiguous: false };
    const unit = numeric[2];
    const multiplier = unit === "m" || unit === "trieu" || unit === "million"
      ? 1_000_000
      : unit === "k" || unit === "nghin" || unit === "ngan" || unit === "thousand"
        ? 1_000
        : spokenAmountUnit;
    const value = Math.floor(base * multiplier);
    return {
      value: Number.isSafeInteger(value) && value > 0 ? value : null,
      ambiguous: !unit && !(amountUnitConfirmed && spokenAmountUnit === 1_000),
    };
  }

  const tokens = transcript.split(" ");
  for (let index = 0; index < tokens.length; index += 1) {
    const number = NUMBER_WORDS[tokens[index]];
    if (number === undefined || number <= 0) continue;
    const unit = tokens[index + 1];
    const multiplier = unit === "million" || unit === "trieu"
      ? 1_000_000
      : unit === "thousand" || unit === "nghin" || unit === "ngan"
        ? 1_000
        : spokenAmountUnit;
    const value = number * multiplier;
    return {
      value,
      ambiguous: !unit && !(amountUnitConfirmed && spokenAmountUnit === 1_000),
    };
  }
  return { value: null, ambiguous: false };
}

export function parseTrackerVoiceCommand(
  transcript: string,
  options: { spokenAmountUnit: number; amountUnitConfirmed: boolean },
): TrackerVoiceParsedCommand | null {
  const normalizedTranscript = normalize(transcript);
  if (!normalizedTranscript) return null;
  const match = COMMANDS.find(({ pattern }) => pattern.test(normalizedTranscript));
  if (!match) return null;
  const needsAmount = match.kind === "bet_to" || match.kind === "raise_to";
  const parsedAmount = needsAmount
    ? parseAmount(normalizedTranscript, options.spokenAmountUnit, options.amountUnitConfirmed)
    : { value: null, ambiguous: false };
  return {
    kind: match.kind,
    normalizedTranscript,
    amount: parsedAmount.value,
    amountAmbiguous: parsedAmount.ambiguous,
  };
}
