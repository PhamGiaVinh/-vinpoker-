import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENSITIVE_CREDENTIAL_NAMES = [
  "SUPABASEACCESTOKEN",
  "VBACKER",
  "VBACKER1",
  "VERCELTOKEN",
];

const SUPPORTED_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".js",
  ".mjs",
  ".mts",
  ".ps1",
  ".sh",
  ".ts",
  ".cts",
  ".yaml",
  ".yml",
]);

const credentialAlternation = SENSITIVE_CREDENTIAL_NAMES.join("|");
const UNSAFE_VARIABLE_REFERENCE_PATTERNS = [
  new RegExp(`\\bvars\\s*\\.\\s*(${credentialAlternation})\\b`, "gi"),
  new RegExp(`\\bvars\\s*\\[\\s*[\"']\\s*(${credentialAlternation})\\s*[\"']\\s*\\]`, "gi"),
];

function walkFiles(directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    return entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name)) ? [entryPath] : [];
  });
}

function lineNumberAt(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

export function findUnsafeVariableReferences(content) {
  const findings = [];

  for (const pattern of UNSAFE_VARIABLE_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
      findings.push({
        credentialName: match[1].toUpperCase(),
        line: lineNumberAt(content, match.index),
      });
    }
  }

  return findings.sort((left, right) => left.line - right.line || left.credentialName.localeCompare(right.credentialName));
}

export function scanCredentialContexts(repositoryRoot) {
  const targets = [
    resolve(repositoryRoot, ".github", "workflows"),
    resolve(repositoryRoot, ".github", "actions"),
    resolve(repositoryRoot, "scripts"),
    resolve(repositoryRoot, "VinPoker", "scripts"),
  ];

  return targets.flatMap((target) =>
    walkFiles(target).flatMap((filePath) =>
      findUnsafeVariableReferences(readFileSync(filePath, "utf8")).map((finding) => ({
        ...finding,
        file: relative(repositoryRoot, filePath).replaceAll("\\", "/"),
      })),
    ),
  );
}

function run() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, "..", "..", "..");
  const findings = scanCredentialContexts(repositoryRoot);

  if (findings.length === 0) {
    console.log("Sensitive credential context guard passed.");
    return;
  }

  console.error("Unsafe GitHub Actions vars.* credential references found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.credentialName})`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) run();
