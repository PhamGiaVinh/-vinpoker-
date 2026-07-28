import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { sanitizeSchemaArtifactSql } from "./validate-live-public-schema-artifact.mjs";

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

function run() {
  const inputPath = readArgument(process.argv.slice(2), "--input");
  const outputPath = readArgument(process.argv.slice(2), "--output");
  if (!inputPath || !outputPath) throw new Error("--input and --output are required");
  if (resolve(inputPath) === resolve(outputPath)) throw new Error("input and output paths must differ");

  const { sanitizedSql, redactionCount } = sanitizeSchemaArtifactSql(readFileSync(inputPath, "utf8"));
  writeFileSync(outputPath, sanitizedSql, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ schema_artifact_sanitized: true, redaction_count: redactionCount }));
}

try {
  run();
} catch (error) {
  console.error(`SCHEMA_ARTIFACT_SANITIZATION_FAILED: ${error instanceof Error ? error.message : "unknown_error"}`);
  process.exitCode = 1;
}
