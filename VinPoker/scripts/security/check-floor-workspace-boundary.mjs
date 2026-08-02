import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const BANNED_SOURCE_PATTERNS = [
  {
    label: "global-player-supabase-client",
    pattern: /@\/integrations\/supabase\/client/u,
  },
  {
    label: "direct-prize-payment-rpc",
    pattern: /record_tournament_prize_payment/u,
  },
  {
    label: "direct-payment-ui",
    pattern: /PrizePayoutTrackingSection|PayoutEnginePanel/u,
  },
  {
    label: "history-dependent-back",
    pattern: /navigate\s*\(\s*-1\s*\)/u,
  },
];

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

export async function inspectFloorWorkspaceBoundary(root) {
  const floorRoot = path.join(root, "src", "ops", "floor");
  const files = await sourceFiles(floorRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    for (const rule of BANNED_SOURCE_PATTERNS) {
      if (rule.pattern.test(source)) violations.push({ file: relative, rule: rule.label });
    }
    if (
      path.basename(file) === "PayoutWorkspace.tsx"
      && /\.rpc\s*\(|\.functions\.invoke\s*\(/u.test(source)
    ) {
      violations.push({ file: relative, rule: "payout-workspace-mutation" });
    }
  }

  const routes = await readFile(path.join(root, "src", "OpsApp.tsx"), "utf8");
  const requiredRoutes = [
    "/ops/floor",
    "tables",
    "players",
    "clock",
    "payout",
    "screens",
  ];
  for (const route of requiredRoutes) {
    if (!routes.includes(route)) {
      violations.push({ file: "src/OpsApp.tsx", rule: `missing-route:${route}` });
    }
  }

  return { files, violations };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const rootFlag = process.argv.indexOf("--root");
    const root = path.resolve(rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd());
    const result = await inspectFloorWorkspaceBoundary(root);
    if (result.violations.length > 0) {
      for (const violation of result.violations) {
        process.stderr.write(`FLOOR_WORKSPACE_BOUNDARY_VIOLATION ${violation.file} ${violation.rule}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write(`FLOOR_WORKSPACE_BOUNDARY_PASS files=${result.files.length}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `FLOOR_WORKSPACE_BOUNDARY_FAIL ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
