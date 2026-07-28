import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const EXPECTED_SCHEMA_FILE = "live-public-schema.sql";
const EXPECTED_CHECKSUM_FILE = "live-public-schema.sha256";

function codeOnlySql(sql) {
  let output = "";
  let index = 0;
  let state = "normal";
  let blockDepth = 0;
  let dollarTag = "";

  const blank = (character) => {
    output += character === "\n" ? "\n" : " ";
  };

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (state === "normal") {
      if (character === "-" && next === "-") {
        blank(character);
        blank(next);
        index += 2;
        state = "line_comment";
        continue;
      }
      if (character === "/" && next === "*") {
        blank(character);
        blank(next);
        index += 2;
        blockDepth = 1;
        state = "block_comment";
        continue;
      }
      if (character === "'") {
        blank(character);
        index += 1;
        state = "single_quote";
        continue;
      }
      if (character === '"') {
        blank(character);
        index += 1;
        state = "double_quote";
        continue;
      }
      if (character === "$") {
        const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag) {
          output += " ".repeat(tag.length);
          index += tag.length;
          dollarTag = tag;
          state = "dollar_quote";
          continue;
        }
      }
      output += character;
      index += 1;
      continue;
    }

    if (state === "line_comment") {
      blank(character);
      index += 1;
      if (character === "\n") state = "normal";
      continue;
    }

    if (state === "block_comment") {
      if (character === "/" && next === "*") {
        blank(character);
        blank(next);
        blockDepth += 1;
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        blank(character);
        blank(next);
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = "normal";
        continue;
      }
      blank(character);
      index += 1;
      continue;
    }

    if (state === "single_quote") {
      blank(character);
      if (character === "'" && next === "'") {
        blank(next);
        index += 2;
      } else {
        index += 1;
        if (character === "'") state = "normal";
      }
      continue;
    }

    if (state === "double_quote") {
      blank(character);
      if (character === '"' && next === '"') {
        blank(next);
        index += 2;
      } else {
        index += 1;
        if (character === '"') state = "normal";
      }
      continue;
    }

    if (state === "dollar_quote") {
      if (sql.startsWith(dollarTag, index)) {
        output += " ".repeat(dollarTag.length);
        index += dollarTag.length;
        dollarTag = "";
        state = "normal";
      } else {
        blank(character);
        index += 1;
      }
    }
  }

  if (state === "line_comment") state = "normal";
  if (state !== "normal") throw new Error("schema SQL has an unterminated comment or quoted literal");
  return output;
}

function secretKinds(sql) {
  const patterns = [
    ["jwt_like", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
    ["database_url", /\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi],
    ["supabase_pat", /\bsbp_[A-Za-z0-9_-]{16,}\b/g],
    ["supabase_key", /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}\b/gi],
    ["telegram_token", /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g],
    ["vercel_token", /\b(?:vcp|vercel)_[A-Za-z0-9_-]{16,}\b/gi],
    ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ["phone", /(?<![\dA-Za-z])(?:\+?84|0)\d{9,10}(?!\d)/g],
  ];
  return patterns.filter(([, pattern]) => pattern.test(sql)).map(([kind]) => kind);
}

export function schemaArtifactProblems(sql) {
  const code = codeOnlySql(sql);
  const problems = [];
  if (/(?:^|;)\s*COPY\b[\s\S]*?\bFROM\s+stdin\b/i.test(code)) problems.push("copy_from_stdin");
  if (/(?:^|;)\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(code)) problems.push("top_level_data_statement");
  for (const kind of secretKinds(sql)) problems.push(`sensitive_${kind}`);
  return problems;
}

export function validateArtifactDirectory(directory) {
  const resolvedDirectory = resolve(directory);
  const files = readdirSync(resolvedDirectory).sort();
  const expectedFiles = [EXPECTED_CHECKSUM_FILE, EXPECTED_SCHEMA_FILE];
  if (files.length !== expectedFiles.length || files.some((file, index) => file !== expectedFiles[index])) {
    throw new Error("schema artifact must contain exactly live-public-schema.sql and live-public-schema.sha256");
  }

  const schemaPath = resolve(resolvedDirectory, EXPECTED_SCHEMA_FILE);
  const checksumPath = resolve(resolvedDirectory, EXPECTED_CHECKSUM_FILE);
  const schema = readFileSync(schemaPath, "utf8");
  const expectedChecksum = readFileSync(checksumPath, "utf8").trim().match(/^([a-f0-9]{64})\s+\*?live-public-schema\.sql$/)?.[1];
  if (!expectedChecksum) throw new Error("schema artifact checksum file is invalid");

  const actualChecksum = createHash("sha256").update(schema).digest("hex");
  if (actualChecksum !== expectedChecksum) throw new Error("schema artifact checksum mismatch");

  const problems = schemaArtifactProblems(schema);
  if (problems.length) throw new Error(`schema artifact is unsafe: ${problems.join(",")}`);

  return { schemaSha256: actualChecksum, schemaOnly: true, secretsDetected: false };
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

function run() {
  const artifactDirectory = readArgument(process.argv.slice(2), "--artifact-directory");
  if (!artifactDirectory) throw new Error("--artifact-directory is required");
  const result = validateArtifactDirectory(artifactDirectory);
  console.log(JSON.stringify({
    artifact_name: "live-public-schema",
    schema_sha256: result.schemaSha256,
    schema_only: result.schemaOnly,
    secrets_detected: result.secretsDetected,
  }));
}

if (process.argv[1] && basename(process.argv[1]) === "validate-live-public-schema-artifact.mjs") {
  try {
    run();
  } catch (error) {
    console.error(`SCHEMA_ARTIFACT_REJECTED: ${error instanceof Error ? error.message : "unknown_error"}`);
    process.exitCode = 1;
  }
}
