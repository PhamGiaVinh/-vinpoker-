import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const productionProjectRef = ["orles", "ggcjamwuknxwcpk"].join("");
const publishableDirectories = ["contracts", "docs", "fixtures", "registry", "workflows"];
const publishableRootFiles = [
  ".env.example",
  "compose.yaml",
  "Dockerfile.gateway",
  "README.md",
  "package.json",
  "package-lock.json",
];

const patterns = [
  ["production Supabase project ref", new RegExp(productionProjectRef, "gi")],
  ["Supabase production endpoint", /https:\/\/[a-z0-9-]+\.supabase\.co/gi],
  ["production Vercel endpoint", /https?:\/\/(?:www\.)?vinpoker\.vercel\.app/gi],
  ["JWT-like token", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["Vercel token-like value", /\bvcp_[A-Za-z0-9_-]{20,}\b/g],
  ["service role marker", /\bservice_role\b/gi],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["real-looking email", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.(?!invalid\b)[a-z]{2,}\b/gi],
  ["Vietnamese phone-like value", /(?<!\d)(?:\+?84\d{9}|0\d{9})(?!\d)/g],
];

const sensitiveAssignmentPattern =
  /(?:password|secret|api[_-]?key|hmac(?:[_-]?(?:current|next))?[_-]?key|encryption[_-]?key)\s*[:=]\s*["']?(?!replace-|placeholder|local-only|process\.env\.|import\.meta\.env\.|\$\{)[^\s"';]{16,}/i;

export function scanRepositorySecretLeaks({ projectRoot, runGit = defaultRunGit } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  const files = collectRepositoryArtifacts({ projectRoot, runGit });
  const findings = [];

  for (const relative of files) {
    const absolute = resolveProjectFile(projectRoot, relative);
    if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;

    const buffer = fs.readFileSync(absolute);
    if (!isTextFile(buffer)) continue;

    const text = buffer.toString("utf8");
    for (const [label, pattern] of patterns) {
      if (
        (relative.startsWith("contracts/") || relative.startsWith("test/")) &&
        ["real-looking email", "Vietnamese phone-like value"].includes(label)
      ) {
        continue;
      }
      pattern.lastIndex = 0;
      if (pattern.test(text)) findings.push({ relative, label });
    }
    if (sensitiveAssignmentPattern.test(text)) {
      findings.push({ relative, label: "possible hardcoded secret" });
    }
  }

  return { files, findings };
}

export function collectRepositoryArtifacts({ projectRoot, runGit = defaultRunGit } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const candidates = new Set();
  for (const relative of listGitFiles(projectRoot, runGit, ["ls-files", "-z", "--", "."])) {
    candidates.add(relative);
  }
  for (const relative of listGitFiles(projectRoot, runGit, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACMR",
    "--",
    ".",
  ])) {
    candidates.add(relative);
  }
  for (const relative of listPublishableArtifacts(projectRoot)) candidates.add(relative);

  return [...candidates]
    .map(normalizeRelative)
    .filter(Boolean)
    .filter((relative) => resolveProjectFile(projectRoot, relative))
    .sort();
}

export function formatRepositorySecretScan(result) {
  if (!result.findings.length) {
    return `PASS: scanned ${result.files.length} tracked, staged or publishable source artifacts; no production endpoint, secret or real-looking PII marker found.`;
  }
  return `FAIL: repository hygiene findings\n- ${result.findings
    .map(({ relative, label }) => `${relative}: ${label}`)
    .join("\n- ")}`;
}

function listGitFiles(projectRoot, runGit, args) {
  return splitNul(runGit(args, projectRoot));
}

function listPublishableArtifacts(projectRoot) {
  const files = [];
  for (const relative of publishableRootFiles) {
    if (resolveProjectFile(projectRoot, relative)) files.push(relative);
  }
  for (const directory of publishableDirectories) {
    const absolute = resolveProjectFile(projectRoot, directory);
    if (absolute && fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      files.push(...walkPublishableDirectory(projectRoot, absolute));
    }
  }
  return files;
}

function walkPublishableDirectory(projectRoot, directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkPublishableDirectory(projectRoot, absolute);
    return [path.relative(projectRoot, absolute).replaceAll("\\", "/")];
  });
}

function normalizeRelative(value) {
  if (!value || path.isAbsolute(value)) return null;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

function resolveProjectFile(projectRoot, relative) {
  const normalized = normalizeRelative(relative);
  if (!normalized) return null;
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, normalized);
  const parent = path.relative(root, absolute);
  return parent && !parent.startsWith(`..${path.sep}`) && parent !== ".." ? absolute : null;
}

function splitNul(output) {
  return String(output)
    .split("\0")
    .filter(Boolean);
}

function isTextFile(buffer) {
  return !buffer.includes(0);
}

function defaultRunGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
