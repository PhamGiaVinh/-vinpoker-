import type { ParsedVoiceAmount } from "./types";

const VI_DIGITS: Record<string, number> = {
  khong: 0,
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
  muoi: 10,
};

const EN_DIGITS: Record<string, number> = {
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function parseVietnameseWords(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let consumed = false;
  for (const token of tokens) {
    if (token === "tram") {
      current = Math.max(1, current) * 100;
      consumed = true;
      continue;
    }
    if (token === "muoi") {
      current += 10;
      consumed = true;
      continue;
    }
    const digit = VI_DIGITS[token];
    if (digit !== undefined) {
      current += digit;
      consumed = true;
      continue;
    }
    if (token === "linh" || token === "le") continue;
    if (token === "nghin" || token === "ngan") {
      total += Math.max(1, current) * 1_000;
      current = 0;
      consumed = true;
      continue;
    }
    if (token === "trieu") {
      total += Math.max(1, current) * 1_000_000;
      current = 0;
      consumed = true;
      continue;
    }
  }
  return consumed ? total + current : null;
}

function parseEnglishWords(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let consumed = false;
  for (const token of tokens) {
    const digit = EN_DIGITS[token];
    if (digit !== undefined) {
      current += digit;
      consumed = true;
      continue;
    }
    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      consumed = true;
      continue;
    }
    if (token === "thousand") {
      total += Math.max(1, current) * 1_000;
      current = 0;
      consumed = true;
      continue;
    }
    if (token === "million") {
      total += Math.max(1, current) * 1_000_000;
      current = 0;
      consumed = true;
      continue;
    }
    if (token === "and") continue;
  }
  return consumed ? total + current : null;
}

export function parseSpokenAmount(
  rawInput: string,
  options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean } = {},
): ParsedVoiceAmount {
  const raw = rawInput.trim();
  if (!raw) return { value: null, raw: null, explicitUnit: false, ambiguous: false };

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/,/g, ".")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const numeric = normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s*)(k|m|nghin|ngan|trieu|thousand|million)?(?:\s|$)/);
  if (numeric) {
    const base = Number(numeric[1]);
    const unitToken = numeric[2] ?? null;
    const multiplier =
      unitToken === "m" || unitToken === "trieu" || unitToken === "million"
        ? 1_000_000
        : unitToken === "k" || unitToken === "nghin" || unitToken === "ngan" || unitToken === "thousand"
          ? 1_000
          : options.spokenAmountUnit ?? 1;
    const explicitUnit = unitToken !== null;
    const value = Number.isFinite(base) ? Math.round(base * multiplier) : null;
    return {
      value,
      raw,
      explicitUnit,
      ambiguous: value !== null && !explicitUnit && options.amountUnitConfirmed !== true,
    };
  }

  const tokens = normalized.split(" ");
  const explicitUnit = tokens.some((token) =>
    ["nghin", "ngan", "trieu", "thousand", "million"].includes(token),
  );
  const words = parseVietnameseWords(tokens) ?? parseEnglishWords(tokens);
  if (words === null) return { value: null, raw, explicitUnit: false, ambiguous: false };
  const value = explicitUnit ? words : Math.round(words * (options.spokenAmountUnit ?? 1));
  return {
    value,
    raw,
    explicitUnit,
    ambiguous: !explicitUnit && options.amountUnitConfirmed !== true,
  };
}
