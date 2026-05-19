/**
 * translate-placeholders.mjs
 *
 * Replaces all [JA] and [TH] placeholder values in ja.json and th.json
 * with proper Japanese and Thai translations.
 *
 * The translation map is specified in a compact TSV-like format embedded below.
 * Format per line:  flattened_key | Japanese | Thai
 *
 * Usage:  node scripts/translate-placeholders.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "..", "src", "i18n", "locales");

// ─── TRANSLATION MAP ───────────────────────────────────────────────────────────
// Compact format: "flattened.key | JA translation | TH translation"
// Read from external data file if exists, otherwise embedded below.
// ───────────────────────────────────────────────────────────────────────────────

const DATA_FILE = join(__dirname, "translations", "ja-th.txt");
const EMBEDDED_DATA = `

`;

function loadMap() {
  const map = {};
  const lines = [];

  // Try external file first
  if (existsSync(DATA_FILE)) {
    const text = readFileSync(DATA_FILE, "utf8");
    lines.push(...text.split("\n").filter((l) => l.trim() && !l.startsWith("#")));
  }

  // Then embedded data
  lines.push(...EMBEDDED_DATA.split("\n").filter((l) => l.trim() && !l.startsWith("#")));

  for (const line of lines) {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length >= 3) {
      const key = parts[0];
      map[key] = { ja: parts[1], th: parts[2] };
    }
  }

  return map;
}

function flatten(obj, prefix = "") {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result[key] = v;
    } else if (v && typeof v === "object") {
      Object.assign(result, flatten(v, key));
    }
  }
  return result;
}

function unflatten(flat) {
  const result = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split(".");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = val;
  }
  return result;
}

function main() {
  const map = loadMap();
  const mapKeys = Object.keys(map);
  console.log(`Loaded ${mapKeys.length} translation entries`);

  // Load en.json as reference
  const enRaw = JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8"));
  const enFlat = flatten(enRaw);

  for (const lang of ["ja", "th"]) {
    const fp = join(LOCALES_DIR, `${lang}.json`);
    const data = JSON.parse(readFileSync(fp, "utf8"));
    const flat = flatten(data);

    let translated = 0;
    let skipped = 0;
    const seen = new Set();

    for (const [key, val] of Object.entries(flat)) {
      if (map[key] && map[key][lang]) {
        flat[key] = map[key][lang];
        translated++;
        seen.add(key);
      } else if (val.startsWith(`[${lang.toUpperCase()}]`)) {
        // No translation in map — keep English value (clean, no prefix)
        flat[key] = enFlat[key] || val.replace(`[${lang.toUpperCase()}] `, "");
        skipped++;
      }
    }

    const out = unflatten(flat);
    writeFileSync(fp, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`${lang}.json: ${translated} translated, ${skipped} fell back to English`);
  }

  // Also fix zh-CN missing key
  const zhRaw = JSON.parse(readFileSync(join(LOCALES_DIR, "zh-CN.json"), "utf8"));
  const zhFlat = flatten(zhRaw);
  if (!zhFlat["tournamentsPage.packages"]) {
    zhFlat["tournamentsPage.packages"] = "赛事套餐";
    const out = unflatten(zhFlat);
    writeFileSync(join(LOCALES_DIR, "zh-CN.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log("zh-CN.json: added tournamentsPage.packages = 赛事套餐");
  }

  // Also fix ko missing key
  const koRaw = JSON.parse(readFileSync(join(LOCALES_DIR, "ko.json"), "utf8"));
  const koFlat = flatten(koRaw);
  if (!koFlat["tournamentsPage.packages"]) {
    koFlat["tournamentsPage.packages"] = "토너먼트 패키지";
    const out = unflatten(koFlat);
    writeFileSync(join(LOCALES_DIR, "ko.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log("ko.json: added tournamentsPage.packages = 토너먼트 패키지");
  }
}

main();
