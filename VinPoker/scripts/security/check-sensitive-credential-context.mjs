import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENSITIVE_CREDENTIAL_NAMES = [
  "SUPABASEACCESTOKEN",
  "SUPABASEACCESSTOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "VBACKER",
  "VBACKER1",
  "VERCELTOKEN",
  "VERCEL_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PUBLISHABLE_KEY",
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

const HARDCODED_WORKFLOW_CREDENTIAL_PATTERNS = [
  {
    credentialName: "SUPABASE_PUBLISHABLE_KEY",
    pattern: /\bVITE_SUPABASE_PUBLISHABLE_KEY\s*:\s*["'](?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)["']/gi,
  },
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

export function findHardcodedCredentialLikeLiterals(content) {
  const findings = [];

  for (const { credentialName, pattern } of HARDCODED_WORKFLOW_CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      findings.push({
        credentialName,
        line: lineNumberAt(content, match.index ?? 0),
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

  const variableFindings = targets.flatMap((target) =>
    walkFiles(target).flatMap((filePath) =>
      findUnsafeVariableReferences(readFileSync(filePath, "utf8")).map((finding) => ({
        ...finding,
        kind: "unsafe-vars-reference",
        file: relative(repositoryRoot, filePath).replaceAll("\\", "/"),
      })),
    ),
  );

  const workflowTargets = [
    resolve(repositoryRoot, ".github", "workflows"),
    resolve(repositoryRoot, ".github", "actions"),
  ];
  const literalFindings = workflowTargets.flatMap((target) =>
    walkFiles(target).flatMap((filePath) =>
      findHardcodedCredentialLikeLiterals(readFileSync(filePath, "utf8")).map((finding) => ({
        ...finding,
        kind: "hardcoded-credential-like-literal",
        file: relative(repositoryRoot, filePath).replaceAll("\\", "/"),
      })),
    ),
  );

  return [...variableFindings, ...literalFindings].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.kind.localeCompare(right.kind),
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

  console.error("Unsafe credential context found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.kind}; ${finding.credentialName})`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) run();
