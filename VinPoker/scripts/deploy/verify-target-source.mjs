import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, parseTargetList } from "./deployment-manifest.mjs";

const IMPORT_PATTERN = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const SECRET_PATTERNS = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["jwt_literal", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["supabase_secret_literal", /\bsb_secret_[A-Za-z0-9_-]{12,}\b/],
  ["telegram_bot_token_literal", /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/],
  ["sensitive_assignment_literal", /\b(?:token|secret|password|api[_-]?key)\b\s*[:=]\s*["'][^"']{12,}["']/i],
];

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function resolveLocalImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(importer), specifier);
  const candidates = extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}.mjs`, resolve(candidate, "index.ts")];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

function assertInsideRoot(root, path) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || rel === "" && !existsSync(path)) throw new Error(`import escapes target source root: ${path}`);
}

function targetConfigVerifyJwt(targetRoot, name) {
  const configPath = resolve(targetRoot, "VinPoker", "supabase", "config.toml");
  if (!existsSync(configPath)) return true;
  const source = readFileSync(configPath, "utf8");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(
    `(?:^|\\r?\\n)\\s*\\[functions\\.["']?${escaped}["']?\\]\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\s*\\[|$)`,
    "i",
  ).exec(source);
  if (!section) return true;
  const setting = /^\s*verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$/mi.exec(section[1]);
  return setting ? setting[1].toLowerCase() === "true" : true;
}

export function inspectImportGraph(entrypoint, targetRoot) {
  const root = realpathSync(targetRoot);
  const pending = [realpathSync(entrypoint)];
  const visited = new Set();
  const findings = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    assertInsideRoot(root, file);
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(source)) findings.push({ file: relative(root, file).replaceAll("\\", "/"), label });
    }
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (!specifier.startsWith(".")) continue;
      const imported = resolveLocalImport(file, specifier);
      if (!imported) throw new Error(`unresolved local import ${specifier} from ${relative(root, file)}`);
      assertInsideRoot(root, realpathSync(imported));
      pending.push(realpathSync(imported));
    }
  }
  if (findings.length > 0) {
    throw new Error(`source secret scan failed: ${findings.map((item) => `${item.file}:${item.label}`).join(", ")}`);
  }
  return [...visited].map((file) => relative(root, file).replaceAll("\\", "/")).sort();
}

export function inspectTargetSource({ targetRoot, targets, manifest }) {
  const functions = {};
  for (const name of targets) {
    const config = manifest.functions[name];
    if (!config?.critical) throw new Error(`target ${name} is not a declared critical function`);
    const directory = resolve(targetRoot, config.path);
    const entrypoint = resolve(directory, "index.ts");
    if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`target function directory is missing: ${config.path}`);
    if (!existsSync(entrypoint)) throw new Error(`target function entrypoint is missing: ${config.path}/index.ts`);
    const missingTests = config.quality.denoTests.filter((testPath) => !existsSync(resolve(targetRoot, testPath)));
    if (missingTests.length > 0) throw new Error(`target ${name} is missing required Deno tests: ${missingTests.join(", ")}`);
    const configuredVerifyJwt = targetConfigVerifyJwt(targetRoot, name);
    if (config.verifyJwt && !configuredVerifyJwt) {
      throw new Error(`target config disables JWT verification for ${name}, conflicting with the current manifest`);
    }
    functions[name] = {
      entrypoint: `${config.path}/index.ts`,
      verifyJwt: config.verifyJwt,
      targetConfigVerifyJwt: configuredVerifyJwt,
      deployJwtArgument: config.verifyJwt ? "verify-jwt(default)" : "--no-verify-jwt",
      importedFiles: inspectImportGraph(entrypoint, targetRoot),
      denoTests: [...config.quality.denoTests],
    };
  }
  return { targetRoot: realpathSync(targetRoot), functions };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = args.get("target-root");
  const targetsRaw = args.get("targets");
  const reportPath = args.get("report");
  if (!targetRoot || targetsRaw === undefined) throw new Error("target-root and targets are required");
  const targets = parseTargetList(targetsRaw);
  const report = inspectTargetSource({ targetRoot, targets, manifest: loadDeploymentManifest() });
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Target source quality inventory passed for ${targets.join(", ") || "no Edge targets"}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
