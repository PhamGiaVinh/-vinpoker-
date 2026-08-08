import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FILES = [
  "src/OpsApp.tsx",
  "src/components/ops/OpsBottomNav.tsx",
  "src/components/ops/OpsHubShell.tsx",
  "src/components/ops/OpsShell.tsx",
  "src/ops/auth/OpsCapabilityProvider.tsx",
  "src/ops/auth/OpsAuthProvider.tsx",
  "src/ops/pages/OpsAccount.tsx",
  "src/ops/pages/OpsEntryResolver.tsx",
  "src/ops/pages/OpsSelectModule.tsx",
  "src/ops/pages/OpsAlertsHub.tsx",
  "src/ops/registry/opsModuleRegistry.ts",
  "src/ops/tracker/OpsTrackerWorkspace.tsx",
  "src/ops/tracker/TrackerWorkspaceView.tsx",
  "src/ops/dealer-control/OpsDealerControlWorkspace.tsx",
  "src/ops/dealer-control/DealerControlWorkspaceView.tsx",
  "src/ops/chip-ops/OpsChipOpsWorkspace.tsx",
  "src/ops/chip-ops/ChipOpsWorkspaceView.tsx",
  "src/ops/finance/OpsFinanceWorkspace.tsx",
  "src/ops/finance/FinanceWorkspaceView.tsx",
  "src/ops/series/OpsSeriesWorkspace.tsx",
  "src/ops/series/SeriesWorkspaceView.tsx",
];

const BROKEN_UTF8 = /(?:Ã.|Â.|Ä.|Æ.|áº.|á»|â€¦|â†’|ï¿½)/gu;

const root = path.resolve(process.cwd());
const failures = [];
for (const relative of FILES) {
  const source = await readFile(path.join(root, relative), "utf8");
  const match = source.match(BROKEN_UTF8);
  if (match) failures.push(`${relative}:${[...new Set(match)].join(",")}`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`OPS_V3_TEXT_FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`OPS_V3_TEXT_PASS files=${FILES.length}\n`);
}
