import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectRoot } from "../src/config.js";

const workflowDir = path.join(projectRoot, "workflows");
const manifestPath = path.join(workflowDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const checkOnly = process.argv.includes("--check");
let changed = false;

for (const workflow of manifest.workflows) {
  const contents = fs.readFileSync(path.join(workflowDir, workflow.file));
  const checksum = createHash("sha256").update(contents).digest("hex");
  if (workflow.checksum_sha256 !== checksum) {
    if (checkOnly) {
      process.stderr.write(
        `Checksum mismatch for ${workflow.file}: expected ${workflow.checksum_sha256}, got ${checksum}\n`,
      );
      process.exitCode = 1;
    } else {
      workflow.checksum_sha256 = checksum;
      changed = true;
    }
  }
}

if (!checkOnly && changed) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write("Updated workflow checksums.\n");
} else if (!checkOnly) {
  process.stdout.write("Workflow checksums already current.\n");
} else if (!process.exitCode) {
  process.stdout.write("PASS: workflow checksums match the manifest.\n");
}
