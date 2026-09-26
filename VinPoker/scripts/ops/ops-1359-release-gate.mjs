import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const MANIFEST_PATH = "scripts/ops/ops-1359-manifest.json";
export const APPLY_CONFIRMATION = "APPLY_OPS_1359_42_ENTRIES";
const LOCK_KEY_1 = 1359;
const LOCK_KEY_2 = 1;
const ACTIONS = new Set(["APPLY", "SKIP_ALREADY_APPLIED"]);
const CANONICAL_VERSIONS = "20260924165219,20270115000006,20270115000007,20270115000008,20270115000009,20270115000010,20270115000011,20260924065041,20270118000001,20270119000000,20270117000001,20270118000002,20270117000002,20260925092509,20270119000002,20270119000003,20270119000004,20270119000005,20270119000006,20270119000007,20270119000009,20270119000008,20270119000010,20270119000011,20270119000012,20270119000013,20270119000014,20270120000000,20270120000001,20270120000002,20270120000003,20270120000004,20270120000005,20270119000001,20270120000006,20270120000007,20270120000008,20270120000009,20270120000010,20270120000011,20270120000012,20270126000001".split(",");

export function validateManifest(manifest) {
  if (manifest?.projectRef !== PROJECT_REF || manifest?.centerpointId !== "22222222-2222-2222-2222-222222222222" ||
      manifest?.releaseBaseSha !== "b7d224c368bc2d0033d6a6bd917b1c9af3ca0e49" || !Array.isArray(manifest.migrations) || manifest.migrations.length !== 42) {
    throw new Error("Manifest identity or 42-entry release boundary is invalid");
  }
  const versions = new Set();
  const paths = new Set();
  if (manifest.migrations.map((item) => item.version).join(",") !== CANONICAL_VERSIONS.join(",")) throw new Error("Manifest order differs from canonical release order");
  for (const [index, item] of manifest.migrations.entries()) {
    if (!/^\d{14}$/.test(item.version) || !/^[a-z0-9_]+$/.test(item.name) ||
        item.path !== `supabase/${item.path.startsWith("supabase/migrations/") ? "migrations" : "pending-migrations"}/${item.version}_${item.name}.sql` ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || !ACTIONS.has(item.action)) throw new Error(`Invalid manifest entry ${index + 1}`);
    if (versions.has(item.version) || paths.has(item.path)) throw new Error("Duplicate migration version or path");
    versions.add(item.version);
    paths.add(item.path);
  }
  const skips = manifest.migrations.filter((item) => item.action === "SKIP_ALREADY_APPLIED");
  if (skips.length !== 1 || skips[0].version !== "20270115000011" || skips[0].name !== "cashier_refund_without_floor_clearance" ||
      manifest.migrations.filter((item) => item.action === "APPLY").length !== 41) throw new Error("Release actions do not match the canonical allowlist");
  return manifest;
}

export function resolveWithinRoot(root, candidate) {
  const resolvedRoot = resolve(root);
  if (isAbsolute(candidate)) throw new Error("Path escaped source root");
  const fullPath = resolve(resolvedRoot, candidate);
  const rel = relative(resolvedRoot, fullPath);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error("Path escaped source root");
  }
  return fullPath;
}

export function canonicalSqlText(source) {
  const text = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  return text.replace(/\r\n?/g, "\n");
}

export function loadAndValidateManifest(sourceRoot, manifestPath = MANIFEST_PATH) {
  const fullManifest = resolveWithinRoot(sourceRoot, manifestPath);
  const manifest = validateManifest(JSON.parse(readFileSync(fullManifest, "utf8")));
  const files = new Map();
  for (const item of manifest.migrations) {
    const fullPath = resolveWithinRoot(sourceRoot, item.path);
    const sql = canonicalSqlText(readFileSync(fullPath, "utf8"));
    const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");
    if (sha256 !== item.sha256) throw new Error(`Migration checksum mismatch: ${item.version}`);
    files.set(item.version, sql);
  }
  return { manifest, files };
}

export function scanMigrationSource(source) {
  const text = canonicalSqlText(source);
  const statements = [];
  let tokens = [];
  let i = 0;
  let statementStart = -1;
  let state = "normal";
  let dollarTag = "";
  let blockDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "line-comment") { if (ch === "\n") state = "normal"; i += 1; continue; }
    if (state === "block-comment") {
      if (ch === "/" && next === "*") { blockDepth += 1; i += 2; continue; }
      if (ch === "*" && next === "/") { blockDepth -= 1; i += 2; if (blockDepth === 0) state = "normal"; continue; }
      i += 1; continue;
    }
    if (state === "single-quote") { if (ch === "'" && next === "'") { i += 2; continue; } if (ch === "'") state = "normal"; i += 1; continue; }
    if (state === "double-quote") { if (ch === '"' && next === '"') { i += 2; continue; } if (ch === '"') state = "normal"; i += 1; continue; }
    if (state === "dollar-quote") { if (text.startsWith(dollarTag, i)) { i += dollarTag.length; state = "normal"; } else i += 1; continue; }
    if (ch === "-" && next === "-") { state = "line-comment"; i += 2; continue; }
    if (ch === "/" && next === "*") { state = "block-comment"; blockDepth = 1; i += 2; continue; }
    if (ch === "'") { state = "single-quote"; i += 1; continue; }
    if (ch === '"') { state = "double-quote"; i += 1; continue; }
    if (ch === "$" ) {
      const match = text.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; state = "dollar-quote"; i += dollarTag.length; continue; }
    }
    if (ch === "\\" && (i === 0 || text[i - 1] === "\n" || text[i - 1] === "\r")) throw new Error("Unsafe migration source: psql meta command");
    if (ch === ";") {
      if (tokens.length) statements.push({ tokens, start: statementStart, end: i + 1 });
      tokens = [];
      statementStart = -1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) { i += 1; continue; }
    if (statementStart < 0) statementStart = i;
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i += 1;
      tokens.push({ value: text.slice(start, i).toUpperCase(), start, end: i });
      continue;
    }
    tokens.push({ value: ch, start: i, end: i + 1 });
    i += 1;
  }
  if (["single-quote", "double-quote", "dollar-quote", "block-comment"].includes(state)) throw new Error("Unsafe migration source: unterminated lexical construct");
  if (tokens.length) statements.push({ tokens, start: statementStart, end: text.length });
  const txWords = new Set(["BEGIN", "COMMIT", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE", "START", "END"]);
  const controlIndexes = statements.map((statement, index) => ({ statement, index }))
    .filter(({ statement }) => txWords.has(statement.tokens[0].value));
  const concurrent = statements.some(({ tokens: t }) => t.some((token, j) => token.value === "CONCURRENTLY" && t.slice(0, j).some((x) => x.value === "INDEX")));
  if (concurrent) throw new Error("Unsafe migration source: CREATE INDEX CONCURRENTLY");
  if (statements.some(({ tokens: t }) => t[0]?.value === "VACUUM")) throw new Error("Unsafe migration source: VACUUM");
  if (controlIndexes.length === 0) return { mode: "wrapped" };
  const first = controlIndexes[0];
  const last = controlIndexes.at(-1);
  const firstOnly = first.statement.tokens.length === 1 && first.statement.tokens[0].value === "BEGIN";
  const lastOnly = last.statement.tokens.length === 1 && last.statement.tokens[0].value === "COMMIT";
  if (controlIndexes.length !== 2 || first.index !== 0 || last.index !== statements.length - 1 || !firstOnly || !lastOnly) {
    throw new Error("Unsafe migration source: transaction control must be one outer BEGIN and terminal COMMIT");
  }
  return { mode: "outer-transaction", insertAfterBegin: first.statement.end, insertBeforeCommit: last.statement.start };
}

export function classifyResume(history, manifest) {
  if (!Array.isArray(history)) throw new Error("Live migration history has invalid shape");
  const byVersion = new Map();
  for (const row of history) {
    const version = String(row.version);
    if (byVersion.has(version)) throw new Error(`Duplicate live ledger version ${version}`);
    byVersion.set(version, String(row.name));
  }
  let gapSeen = false;
  const result = [];
  for (const item of manifest.migrations) {
    const liveName = byVersion.get(item.version);
    if (item.action === "SKIP_ALREADY_APPLIED") {
      if (liveName !== item.name) throw new Error(`SKIP entry is not exact in live ledger: ${item.version}`);
      result.push({ ...item, state: "skipped-exact" });
      continue;
    }
    if (liveName !== undefined) {
      if (liveName !== item.name || gapSeen) throw new Error(`Applied migration conflicts with release order: ${item.version}`);
      result.push({ ...item, state: "already-applied-exact" });
    } else {
      gapSeen = true;
      result.push({ ...item, state: "pending" });
    }
  }
  return result;
}

export function buildAtomicMigrationQuery(item, source) {
  if (item.action !== "APPLY") throw new Error("Only allowlisted APPLY entries can be executed");
  const sql = canonicalSqlText(source);
  const scan = scanMigrationSource(sql);
  const tag = "$ops1359_receipt$";
  if (sql.includes(tag)) throw new Error("Migration source conflicts with receipt delimiter");
  const prefix = `SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';\nSELECT pg_advisory_xact_lock(${LOCK_KEY_1}, ${LOCK_KEY_2});\nDO $ops1359_guard$ BEGIN IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${item.version}' OR name = '${item.name}') THEN RAISE EXCEPTION 'migration ledger conflict'; END IF; END $ops1359_guard$;\n`;
  const receipt = `\nINSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('${item.version}', '${item.name}', ARRAY[${tag}${sql}${tag}]::text[]);\n`;
  if (scan.mode === "outer-transaction") return `${sql.slice(0, scan.insertAfterBegin)}\n${prefix}${sql.slice(scan.insertAfterBegin, scan.insertBeforeCommit)}${receipt}${sql.slice(scan.insertBeforeCommit)}`;
  return `BEGIN;\n${prefix}${sql}\n${receipt}COMMIT;`;
}

async function request(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error("Supabase Management API request failed"); }
  if (!response.ok) throw new Error(`Supabase Management API returned ${response.status}`);
  return response.json();
}

async function readHistory(token) {
  const history = await request("/database/migrations", token);
  if (!Array.isArray(history)) throw new Error("Live migration history shape is invalid");
  return history.map(({ version, name }) => ({ version: String(version), name: String(name) }));
}

async function execute() {
  const mode = process.argv[2];
  if (!["plan", "verify", "apply", "postcheck"].includes(mode)) throw new Error("Usage: node ops-1359-release-gate.mjs plan|verify|apply|postcheck");
  if (process.env.SUPABASE_PROJECT_REF !== PROJECT_REF || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error("Approved Supabase credential context is unavailable");
  if (mode === "apply" && process.env.CONFIRM_OPS_1359_APPLY !== APPLY_CONFIRMATION) throw new Error("Exact apply confirmation is missing");
  const sourceRoot = resolve(import.meta.dirname, "../..");
  const { manifest, files } = loadAndValidateManifest(sourceRoot);
  for (const item of manifest.migrations) if (item.action === "APPLY") scanMigrationSource(files.get(item.version));
  const history = await readHistory(process.env.SUPABASE_ACCESS_TOKEN);
  let states = classifyResume(history, manifest);
  if (mode === "apply") {
    for (const item of states) {
      if (item.action !== "APPLY" || item.state === "already-applied-exact") continue;
      const response = await request("/database/query", process.env.SUPABASE_ACCESS_TOKEN, {
        method: "POST", body: JSON.stringify({ query: buildAtomicMigrationQuery(item, files.get(item.version)) }),
      });
      if (response === null) throw new Error(`Apply acknowledgement was empty at ${item.version}`);
    }
    states = classifyResume(await readHistory(process.env.SUPABASE_ACCESS_TOKEN), manifest);
  }
  if ((mode === "verify" || mode === "postcheck") && states.some((item) => item.action === "APPLY" && item.state === "pending")) throw new Error("Release still has unapplied migrations");
  console.log(`OPS_1359_${mode.toUpperCase()}=${states.map((item) => `${item.version}:${item.state}`).join(",")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  execute().catch((error) => { console.error(`OPS_1359_GATE_FAIL: ${error.message}`); process.exitCode = 1; });
}
