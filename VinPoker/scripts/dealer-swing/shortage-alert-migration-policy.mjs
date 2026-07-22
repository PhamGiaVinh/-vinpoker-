import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const MIGRATION_VERSION = "20270104000006";
export const MIGRATION_BASENAME = `${MIGRATION_VERSION}_dealer_shortage_alert_lifecycle.sql`;
export const MIGRATION_PATH = `supabase/migrations/${MIGRATION_BASENAME}`;
export const MIGRATION_NAME = `${MIGRATION_VERSION}_dealer_shortage_alert_lifecycle`;
export const MIGRATION_SHA256 = "80bb44a66f9341b709821fed7d67208c82c05d6e6125a42a8fe91079de79a549";

export const NEVER_APPLY = Object.freeze([
  "supabase/migrations/20270104000005_dealer_shortage_alert_lifecycle.sql",
]);
export const FLOOR_OWNED = Object.freeze([
  "supabase/migrations/20270104000005_floor_operator_scope_acl.sql",
]);
export const SUPERSEDED_ALERT_PATH = NEVER_APPLY[0];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

// This comparison utility removes comments without interpreting SQL bodies as comments.
export function normalizeExecutableSql(value) {
  const source = normalizeLineEndings(value);
  let normalized = "";
  let index = 0;
  let state = "normal";
  let dollarTag = "";

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "normal") {
      if (character === "-" && next === "-") {
        state = "line_comment";
        index += 2;
        continue;
      }
      if (character === "/" && next === "*") {
        state = "block_comment";
        index += 2;
        continue;
      }
      if (character === "'") state = "single_quote";
      else if (character === '"') state = "double_quote";
      else if (character === "$") {
        const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          state = "dollar_quote";
          dollarTag = tag;
          normalized += tag;
          index += tag.length;
          continue;
        }
      }
      normalized += character;
      index += 1;
      continue;
    }
    if (state === "line_comment") {
      if (character === "\n") {
        normalized += "\n";
        state = "normal";
      }
      index += 1;
      continue;
    }
    if (state === "block_comment") {
      if (character === "*" && next === "/") {
        normalized += " ";
        state = "normal";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single_quote") {
      normalized += character;
      if (character === "'" && next === "'") {
        normalized += next;
        index += 2;
      } else {
        if (character === "'") state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "double_quote") {
      normalized += character;
      if (character === '"' && next === '"') {
        normalized += next;
        index += 2;
      } else {
        if (character === '"') state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "dollar_quote") {
      if (source.startsWith(dollarTag, index)) {
        normalized += dollarTag;
        index += dollarTag.length;
        state = "normal";
        dollarTag = "";
      } else {
        normalized += character;
        index += 1;
      }
    }
  }

  if (state === "block_comment") throw new Error("unterminated SQL block comment");
  if (state === "single_quote" || state === "double_quote" || state === "dollar_quote") {
    throw new Error("unterminated SQL literal");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function migrationInventory(vinPokerRoot) {
  const migrationDirectory = resolve(vinPokerRoot, "supabase/migrations");
  const entries = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = entry.name.match(/^(\d{14})_(.+)\.sql$/);
      return match ? { version: match[1], file: entry.name } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.file.localeCompare(right.file));
  const byVersion = new Map();
  for (const entry of entries) {
    const files = byVersion.get(entry.version) ?? [];
    files.push(entry.file);
    byVersion.set(entry.version, files);
  }
  return { entries, byVersion };
}

export function selectedMigrationProblems(vinPokerRoot) {
  const problems = [];
  const { entries, byVersion } = migrationInventory(vinPokerRoot);
  const candidateFiles = byVersion.get(MIGRATION_VERSION) ?? [];
  if (candidateFiles.length !== 1) {
    problems.push(`candidate version ${MIGRATION_VERSION} resolves to ${candidateFiles.length} files`);
  } else if (candidateFiles[0] !== MIGRATION_BASENAME) {
    problems.push(`candidate version selects unexpected file ${candidateFiles[0]}`);
  }

  const source = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  if (sha256(normalizeLineEndings(source)) !== MIGRATION_SHA256) {
    problems.push("candidate migration checksum mismatch");
  }
  if (/schema_migrations/i.test(normalizeExecutableSql(source))) {
    problems.push("candidate migration touches schema_migrations");
  }
  for (const required of [
    "public.dealer_shortage_alert_incidents",
    "public.advance_dealer_shortage_alert_incident",
    "public.complete_dealer_shortage_alert_notification",
  ]) {
    if (!source.includes(required)) problems.push(`candidate migration misses ${required}`);
  }

  const previousMaximum = entries
    .filter((entry) => entry.version !== MIGRATION_VERSION)
    .map((entry) => entry.version)
    .sort()
    .at(-1);
  if (previousMaximum && MIGRATION_VERSION <= previousMaximum) {
    problems.push(`candidate version ${MIGRATION_VERSION} is not above prior maximum ${previousMaximum}`);
  }
  for (const oldPath of [...NEVER_APPLY, ...FLOOR_OWNED]) {
    if (oldPath === MIGRATION_PATH) problems.push(`candidate path collides with protected path ${oldPath}`);
  }
  return problems;
}

export function migrationEquivalenceProblems(vinPokerRoot) {
  const oldSql = readFileSync(resolve(vinPokerRoot, SUPERSEDED_ALERT_PATH), "utf8");
  const candidateSql = readFileSync(resolve(vinPokerRoot, MIGRATION_PATH), "utf8");
  return normalizeExecutableSql(oldSql) === normalizeExecutableSql(candidateSql)
    ? []
    : ["superseding migration executable SQL differs from the reviewed alert migration"];
}

export function createMigrationRequest(sql) {
  return {
    query: sql,
    name: MIGRATION_NAME,
  };
}

export function historyEntryMatchesCandidate(entry) {
  // The supported Management API accepts an immutable migration name but does
  // not accept a caller-supplied ledger version. Keep the source version in
  // the exact name and fail closed on duplicate or malformed ledger entries.
  return entry?.name === MIGRATION_NAME && /^\d+$/.test(String(entry?.version ?? ""));
}
