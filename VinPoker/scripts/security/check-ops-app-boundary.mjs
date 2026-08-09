import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

const BANNED_RELATIVE_PATHS = new Set([
  "src/App.tsx",
  "src/main.tsx",
  "src/components/Layout.tsx",
  "src/hooks/useAuth.tsx",
  "src/integrations/supabase/client.ts",
  "src/components/EmailVerificationGate.tsx",
  "src/components/LanguagePrompt.tsx",
  "src/components/PushNotificationPrompt.tsx",
  "src/lib/onesignal.ts",
  "src/lib/registerSW.ts",
]);

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue resolving.
    }
  }
  return null;
}

async function resolveLocalImport(root, fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(root, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const extension = path.extname(base);
  const candidates = extension
    ? [base]
    : [
        ...SOURCE_EXTENSIONS.map((item) => `${base}${item}`),
        ...SOURCE_EXTENSIONS.map((item) => path.join(base, `index${item}`)),
      ];
  return firstExisting(candidates);
}

export async function inspectOpsImportGraph(root) {
  const entry = path.join(root, "src", "ops-main.tsx");
  const pending = [entry];
  const visited = new Set();
  const parents = new Map();
  const violations = [];

  while (pending.length) {
    const file = pending.pop();
    const normalized = path.normalize(file);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const relative = path.relative(root, normalized).replaceAll("\\", "/");
    if (BANNED_RELATIVE_PATHS.has(relative)) {
      const chain = [relative];
      let cursor = normalized;
      while (parents.has(cursor)) {
        cursor = parents.get(cursor);
        chain.unshift(path.relative(root, cursor).replaceAll("\\", "/"));
      }
      violations.push(chain);
      continue;
    }

    const source = await readFile(normalized, "utf8");
    if (relative === "src/ops-main.tsx" && /registerServiceWorker|registerSW|\/sw\.js/u.test(source)) {
      violations.push([relative, "service-worker-registration"]);
    }

    const runtimeSource = source
      .replace(/^\s*import\s+type\b[^\n]*$/gmu, "")
      .replace(/^\s*export\s+type\b[^\n]*$/gmu, "");
    for (const match of runtimeSource.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      const resolved = await resolveLocalImport(root, normalized, specifier);
      if (!resolved) continue;
      const child = path.normalize(resolved);
      if (!parents.has(child)) parents.set(child, normalized);
      pending.push(child);
    }
  }

  return { files: [...visited], violations };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const rootFlag = process.argv.indexOf("--root");
    const root = path.resolve(rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd());
    const result = await inspectOpsImportGraph(root);
    if (result.violations.length) {
      for (const chain of result.violations) {
        process.stderr.write(`OPS_BOUNDARY_VIOLATION ${chain.join(" -> ")}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write(`OPS_BOUNDARY_PASS files=${result.files.length}\n`);
    }
  } catch (error) {
    process.stderr.write(`OPS_BOUNDARY_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
