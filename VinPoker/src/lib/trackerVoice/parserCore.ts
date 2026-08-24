/**
 * Pure parser shared by the browser and Edge runtime. It recognizes intent
 * only; legal action and chip-range checks remain in the Tracker engine.
 */
export type TrackerVoiceCoreCommandKind =
  | "fold"
  | "check"
  | "call"
  | "bet_to"
  | "raise_to"
  | "all_in"
  | "report_wrong_action"
  | "call_floor";

export interface TrackerVoiceCoreAmount {
  value: number | null;
  raw: string | null;
  explicitUnit: boolean;
  ambiguous: boolean;
}

export interface TrackerVoiceCoreCommand {
  kind: TrackerVoiceCoreCommandKind;
  normalizedTranscript: string;
  amount: TrackerVoiceCoreAmount | null;
}

export interface TrackerVoiceAmountOptions {
  spokenAmountUnit?: number;
  amountUnitConfirmed?: boolean;
}

type ParsedSmallNumber = {
  value: number;
  next: number;
  consumed: boolean;
  halfMillionTail: boolean;
};

const VI_DIGITS: Record<string, number> = {
  khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5,
  sau: 6, bay: 7, tam: 8, chin: 9,
};

const EN_DIGITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

const THOUSAND_UNITS = new Set(["k", "nghin", "ngan", "thousand"]);
const MILLION_UNITS = new Set(["m", "trieu", "million"]);
const NUMBER_STARTS = new Set([
  ...Object.keys(VI_DIGITS), ...Object.keys(EN_DIGITS), "muoi", "tram", "ruoi", "hundred",
]);

const COMMANDS: Array<{ kind: TrackerVoiceCoreCommandKind; pattern: RegExp }> = [
  { kind: "report_wrong_action", pattern: /\b(bao sai|sai action|wrong action|action sai|tracker(?:\s+ghi)?\s+sai|sai hanh dong)\b/ },
  { kind: "call_floor", pattern: /\b(goi floor|call floor|floor oi|can floor|floor ho tro|floor toi ban)\b/ },
  { kind: "all_in", pattern: /\b(all[ -]?in|o[ -]?in|tat tay|tat ca(?:\s+chip)?)(?!\s+(?:nguoi\s+choi|nhan\s+vien))\b/ },
  { kind: "raise_to", pattern: /\b(?:raise(?:\s+to)?|ray(?:\s+to)?|to(?:\s+len)?|nang(?:\s+len)?)\b(?=\s+(?:\d|mot\b|hai\b|ba\b|bon\b|tu\b|nam\b|one\b|two\b|three\b|four\b|five\b))/ },
  { kind: "bet_to", pattern: /\b(?:bet(?:\s+to)?|cuoc(?:\s+(?:den|len))?)\b(?=\s+(?:\d|mot\b|hai\b|ba\b|bon\b|tu\b|nam\b|one\b|two\b|three\b|four\b|five\b))/ },
  { kind: "call", pattern: /\b(call(?!\s+dien\s+thoai)|theo|theo bai)\b/ },
  { kind: "check", pattern: /\b(check(?!\s+camera)|xem|qua|check bai)\b/ },
  { kind: "fold", pattern: /(?:\b(fold|phau|up bai|bo bai|bo luon|bo van nay|toi bo|bo di)\b|^bo$)/ },
];

const NOISE_PATTERNS = [
  /\b(?:microphone|camera)\s+check\b/,
  /\bcheck\s+camera\b/,
  /\bfold\s+(?:the\s+)?table\s+cloth\b/,
  /\bcall\s+me\b/,
  /\bbo\s+qua\b/,
  /\btat\s+ca\s+(?:nguoi\s+choi|nhan\s+vien)\b/,
];

function amountUnit(options: TrackerVoiceAmountOptions): number {
  const candidate = options.spokenAmountUnit ?? 1;
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 1;
}

function multiplierForUnit(unit: string | undefined): number | null {
  if (!unit) return null;
  if (THOUSAND_UNITS.has(unit)) return 1_000;
  if (MILLION_UNITS.has(unit)) return 1_000_000;
  return null;
}

function numericTokenValue(token: string | undefined): number | null {
  if (!token || !/^\d+(?:\.\d+)?$/.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isAmountStart(token: string | undefined): boolean {
  return numericTokenValue(token) !== null
    || Boolean(token && NUMBER_STARTS.has(token))
    || Boolean(token && /^\d+(?:\.\d+)?[km]$/.test(token));
}

function parseSmallNumber(tokens: string[], start: number): ParsedSmallNumber {
  let value = 0;
  let index = start;
  let consumed = false;
  let halfMillionTail = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "linh" || token === "le" || token === "and") {
      index += 1;
      continue;
    }
    if (token === "ruoi") {
      value += 50;
      consumed = true;
      halfMillionTail = true;
      index += 1;
      continue;
    }
    if (token === "muoi") {
      value += 10;
      consumed = true;
      index += 1;
      continue;
    }
    if (token === "tram" || token === "hundred") {
      value = Math.max(1, value) * 100;
      consumed = true;
      index += 1;
      continue;
    }
    const numeric = numericTokenValue(token);
    const digit = VI_DIGITS[token] ?? EN_DIGITS[token];
    const base = numeric ?? digit;
    if (base === undefined || base === null) break;
    const next = tokens[index + 1];
    if (next === "muoi") {
      value += base * 10;
      consumed = true;
      index += 2;
      continue;
    }
    if (next === "tram" || next === "hundred") {
      value += base * 100;
      consumed = true;
      index += 2;
      continue;
    }
    value += base;
    consumed = true;
    index += 1;
  }

  return { value, next: index, consumed, halfMillionTail };
}

function parseExplicitAmount(tokens: string[], start: number): number | null {
  const compact = tokens[start]?.match(/^(\d+(?:\.\d+)?)(k|m)$/);
  if (compact) {
    const base = Number(compact[1]);
    const multiplier = compact[2] === "k" ? 1_000 : 1_000_000;
    const value = base * multiplier;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const first = parseSmallNumber(tokens, start);
  if (!first.consumed) return null;
  const unit = tokens[first.next];
  const multiplier = multiplierForUnit(unit);
  if (!multiplier) return null;

  let value = first.value * multiplier;
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  if (!MILLION_UNITS.has(unit)) return value;

  const tail = parseSmallNumber(tokens, first.next + 1);
  if (!tail.consumed) return value;
  const tailUnit = tokens[tail.next];
  if (multiplierForUnit(tailUnit) === 1_000) {
    value += tail.value * 1_000;
  } else if (!tailUnit && tail.halfMillionTail) {
    value += 500_000;
  } else if (!tailUnit && tail.value > 0 && tail.value < 10) {
    value += tail.value * 100_000;
  } else if (!tailUnit && tail.value >= 100 && tail.value <= 999) {
    value += tail.value * 1_000;
  } else {
    return null;
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizeTrackerVoiceTranscript(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/[!?;:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTrackerVoiceAmount(
  rawInput: string,
  options: TrackerVoiceAmountOptions = {},
): TrackerVoiceCoreAmount {
  const raw = rawInput.trim();
  if (!raw) return { value: null, raw: null, explicitUnit: false, ambiguous: false };
  const tokens = normalizeTrackerVoiceTranscript(raw)
    .replace(/,/g, ".")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  for (let start = 0; start < tokens.length; start += 1) {
    if (!isAmountStart(tokens[start])) continue;
    const explicit = parseExplicitAmount(tokens, start);
    if (explicit !== null) return { value: explicit, raw, explicitUnit: true, ambiguous: false };

    const small = parseSmallNumber(tokens, start);
    if (!small.consumed || !Number.isSafeInteger(small.value) || small.value <= 0) continue;
    const value = small.value * amountUnit(options);
    if (!Number.isSafeInteger(value) || value <= 0) return { value: null, raw, explicitUnit: false, ambiguous: false };
    return { value, raw, explicitUnit: false, ambiguous: options.amountUnitConfirmed !== true };
  }

  return { value: null, raw, explicitUnit: false, ambiguous: false };
}

export function parseTrackerVoiceCommandCore(
  transcript: string,
  options: TrackerVoiceAmountOptions = {},
): TrackerVoiceCoreCommand | null {
  const normalizedTranscript = normalizeTrackerVoiceTranscript(transcript);
  if (!normalizedTranscript) return null;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(normalizedTranscript))) return null;
  const matched = COMMANDS.find(({ pattern }) => pattern.test(normalizedTranscript));
  if (!matched) return null;
  const amount = matched.kind === "bet_to" || matched.kind === "raise_to"
    ? parseTrackerVoiceAmount(normalizedTranscript, options)
    : null;
  return { kind: matched.kind, normalizedTranscript, amount };
}
