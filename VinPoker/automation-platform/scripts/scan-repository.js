import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "../src/config.js";

const excludedDirectories = new Set(["node_modules", ".local-data", ".git"]);
const excludedFiles = new Set(["package-lock.json"]);
const findings = [];
const files = walk(projectRoot);
const productionProjectRef = ["orles", "ggcjamwuknxwcpk"].join("");
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

for (const file of files) {
  const relative = path.relative(projectRoot, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  for (const [label, pattern] of patterns) {
    if (
      (relative.startsWith("contracts/") || relative.startsWith("test/")) &&
      ["real-looking email", "Vietnamese phone-like value"].includes(label)
    ) continue;
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${relative}: ${label}`);
  }
  if (
    relative !== ".env.example" &&
    /(?:password|secret|api[_-]?key|hmac[_-]?key)\s*[:=]\s*["']?(?!replace-|placeholder|local-only)[A-Za-z0-9+/=_-]{16,}/i.test(text)
  ) {
    findings.push(`${relative}: possible hardcoded secret`);
  }
}

if (findings.length) {
  process.stderr.write(`FAIL: repository hygiene findings\n- ${findings.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `PASS: scanned ${files.length} local source files; no production endpoint, secret or real-looking PII marker found.\n`,
  );
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    if (excludedFiles.has(entry.name)) return [];
    return [entryPath];
  });
}
