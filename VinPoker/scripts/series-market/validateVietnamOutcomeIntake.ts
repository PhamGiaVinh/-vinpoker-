import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalize } from "../../src/lib/series-intelligence/provenanceHash";
import {
  createOutcomeIntakeRecord,
  type OutcomeIntakeRecordInput,
} from "../../src/lib/series-market/vietnamOutcomeEvidence";

const ROOT = process.cwd().endsWith("VinPoker") ? process.cwd() : resolve(process.cwd(), "VinPoker");
const TEMPLATE_PATH = resolve(
  ROOT,
  "src/lib/series-market/fixtures/templates/vietnam-outcome-intake.template.json",
);

export async function validateVietnamOutcomeIntakeTemplate(): Promise<string> {
  const raw = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8")) as {
    readonly templateOnly: boolean;
    readonly warning: string;
  } & OutcomeIntakeRecordInput;
  if (raw.templateOnly !== true || !raw.warning.includes("FICTIONAL")) {
    throw new Error("Outcome intake template must remain explicitly fictional.");
  }
  const record = await createOutcomeIntakeRecord(raw);
  if (record.fixtureOnly !== true || record.source.reviewerStatus !== "intake") {
    throw new Error("Outcome intake template must never be eligible for a release.");
  }
  return canonicalize(record);
}

if (process.argv.includes("--check-template")) {
  validateVietnamOutcomeIntakeTemplate()
    .then(() => process.stdout.write("Vietnam outcome intake template valid.\n"))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
} else if (process.argv[1]?.endsWith("validateVietnamOutcomeIntake.ts")) {
  process.stderr.write("Usage: --check-template. This command does not emit an outcome release.\n");
  process.exitCode = 2;
}
