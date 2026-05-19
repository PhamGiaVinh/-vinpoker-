/**
 * translate-i18n.mjs
 *
 * Dual-mode i18n translation tool for VinPoker.
 *
 * Mode 1 (dry-run): Detects keys that need translation
 *   node scripts/translate-i18n.mjs --source vi --dry-run
 *
 * Mode 2 (API): Translates via OpenRouter (supports OpenAI API key format too)
 *   node scripts/translate-i18n.mjs --source vi
 *   Requires OPENAI_API_KEY in .env or environment
 *
 * Mode 3 (single locale): Translate only one target locale
 *   node scripts/translate-i18n.mjs --source vi --target ja
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "..", "src", "i18n", "locales");
const DOTENV_PATH = join(__dirname, "..", ".env");
const LOCALES = ["vi", "en", "zh-CN", "ko", "ja", "th"];
const ADMIN_PREFIXES = ["admin."];

// Target language metadata for translation prompts
const LANG_META = {
  "zh-CN": { name: "Simplified Chinese", code: "zh-CN", flag: "🇨🇳" },
  ko: { name: "Korean", code: "ko", flag: "🇰🇷" },
  ja: { name: "Japanese", code: "ja", flag: "🇯🇵" },
  th: { name: "Thai", code: "th", flag: "🇹🇭" },
};

// ─── Load .env ───────────────────────────────────────────────────────────────

function loadDotenv() {
  try {
    const text = readFileSync(DOTENV_PATH, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const source = args.includes("--source") ? args[args.indexOf("--source") + 1] : "vi";
  const target = args.includes("--target") ? args[args.indexOf("--target") + 1] : null;
  const dryRun = args.includes("--dry-run");
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "gpt-4o-mini";
  return { source, target, dryRun, model };
}

function loadLocale(code) {
  const fp = join(LOCALES_DIR, `${code}.json`);
  try {
    return JSON.parse(readFileSync(fp, "utf8"));
  } catch (e) {
    console.error(`Cannot load ${code}: ${e.message}`);
    return null;
  }
}

function flatten(obj, prefix = "") {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") result[key] = v;
    else if (v && typeof v === "object") Object.assign(result, flatten(v, key));
  }
  return result;
}

function unflatten(flat) {
  const result = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split(".");
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return result;
}

function isAdminKey(key) {
  return ADMIN_PREFIXES.some((p) => key.startsWith(p));
}

function hasPlaceholder(val) {
  return /^\[(JA|TH|KO|ZH)\]\s/.test(val);
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ─── OpenRouter API call ─────────────────────────────────────────────────────

async function translateBatch(entries, targetLang, sourceLang, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env or environment");

  const isOpenRouter = apiKey.startsWith("sk-or-");
  const baseUrl = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  // Build the prompt
  const pairs = entries.map((e) => `${e.key} = ${JSON.stringify(e.source)}`).join("\n");

  const systemMsg = `You are a translator. Translate the following ${sourceLang} values to ${targetLang}. Keep all keys (the part before "=") unchanged. Return ONLY a JSON object with the translated values. Do not wrap in markdown. Do not explain.`;

  const userMsg = `Translate these ${sourceLang} values to ${targetLang}:\n${pairs}`;

  const body = {
    model,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    temperature: 0.3,
    max_tokens: 4000,
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (isOpenRouter) {
    headers["HTTP-Referer"] = "https://vinpoker.vercel.app";
    headers["X-Title"] = "VinPoker i18n";
  }

  const res = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("API returned empty response");

  // Parse JSON from response (handle possible markdown wrapping)
  let json;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    json = JSON.parse(jsonMatch[0]);
  } else {
    json = JSON.parse(content);
  }

  return json;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  loadDotenv();
  const { source, target, dryRun, model } = parseArgs();

  const apiKey = process.env.OPENAI_API_KEY;
  const apiAvailable = !!apiKey;

  console.log(`Source locale: ${source}`);
  console.log(`API: ${apiAvailable ? "✅ Available (OpenRouter)" : "❌ Not configured (use --dry-run to detect)"}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (detection only)" : "API TRANSLATION"}`);
  if (target) console.log(`Target: ${target}`);
  console.log("");

  const sourceData = loadLocale(source);
  if (!sourceData) process.exit(1);
  const sourceFlat = flatten(sourceData);

  // Load en.json as reference for "is this already translated?"
  const enData = loadLocale("en");
  if (!enData) process.exit(1);
  const enFlat = flatten(enData);

  // Determine which target locales to process
  const targetCodes = target ? [target] : LOCALES.filter((c) => c !== source && c !== "en");

  // Prepare: load all target flats
  const targetData = {};
  const targetFlats = {};
  for (const code of targetCodes) {
    targetData[code] = loadLocale(code);
    if (!targetData[code]) process.exit(1);
    targetFlats[code] = flatten(targetData[code]);
  }

  // Detect keys needing translation
  const needsTranslate = {};

  for (const [key, val] of Object.entries(sourceFlat)) {
    if (isAdminKey(key)) continue;

    for (const code of targetCodes) {
      const tflat = targetFlats[code];
      if (!(key in tflat)) {
        // Key is missing entirely
        if (!needsTranslate[code]) needsTranslate[code] = [];
        needsTranslate[code].push({ key, source: val, reason: "missing" });
      } else if (hasPlaceholder(tflat[key])) {
        // Key still has [JA]/[TH] placeholder prefix
        if (!needsTranslate[code]) needsTranslate[code] = [];
        needsTranslate[code].push({ key, source: val, reason: "placeholder" });
      } else if (key in enFlat && tflat[key] === enFlat[key]) {
        // Key value matches English → not translated yet
        if (!needsTranslate[code]) needsTranslate[code] = [];
        needsTranslate[code].push({ key, source: val, reason: "untranslated" });
      }
    }
  }

  // Report
  let totalNeeded = 0;
  for (const code of targetCodes) {
    const list = needsTranslate[code] || [];
    totalNeeded += list.length;
    console.log(`--- ${code} (${LANG_META[code]?.flag || ""} ${LANG_META[code]?.name || code}) ---`);
    if (list.length === 0) {
      console.log("  All keys translated.");
    } else {
      console.log(`  Needs translation: ${list.length} keys`);
      for (const item of list.slice(0, 5)) {
        console.log(`    - [${item.reason}] ${item.key} = "${item.source.slice(0, 60)}"`);
      }
      if (list.length > 5) console.log(`    ... and ${list.length - 5} more`);
    }
    console.log("");
  }

  console.log("=== SUMMARY ===");
  console.log(`Total keys needing translation: ${totalNeeded}`);

  if (dryRun || totalNeeded === 0) {
    return;
  }

  // ─── API TRANSLATION ───────────────────────────────────────────────────────

  if (!apiAvailable) {
    console.log("\n❌ OPENAI_API_KEY not configured. Set it in .env and run again.");
    process.exit(1);
  }

  console.log("\n🚀 Starting API translation...\n");

  for (const code of targetCodes) {
    const list = needsTranslate[code] || [];
    if (list.length === 0) continue;

    const meta = LANG_META[code];
    const langName = meta?.name || code;
    const flat = targetFlats[code];
    const rawData = targetData[code];

    console.log(`Translating ${list.length} keys to ${langName} (${code})...`);

    // Process in batches of 50
    const batches = chunkArray(list, 50);
    let translated = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} keys)...`);

      try {
        const result = await translateBatch(batch, langName, source === "vi" ? "Vietnamese" : "English", model);

        // Apply translations
        for (const { key } of batch) {
          if (result[key] && typeof result[key] === "string") {
            flat[key] = result[key];
            translated++;
          }
        }

        // Avoid rate limiting
        if (i < batches.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        console.error(`  Batch ${i + 1} failed: ${err.message}`);
        // Continue with next batch
      }
    }

    // Write back
    const out = unflatten(flat);
    writeFileSync(join(LOCALES_DIR, `${code}.json`), JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`  ✅ ${translated}/${list.length} keys translated and written to ${code}.json\n`);
  }

  console.log("=== DONE ===");
}

main().catch(console.error);
