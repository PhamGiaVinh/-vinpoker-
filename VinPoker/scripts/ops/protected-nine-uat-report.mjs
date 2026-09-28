import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const normalizedHash = (source) => createHash("sha256").update(source.replace(/\r\n?/g, "\n"), "utf8").digest("hex");

const output = resolve(process.argv[2] ?? "protected-nine-uat-report.json");
const control = JSON.parse(readFileSync("supabase/migration-control/manifest.json", "utf8"));
const reservations = new Map(control.reservations.map((entry) => [entry.newVersion, entry]));
const migrations = control.protectedApplyOrder.map((version) => reservations.get(version)).map((entry) => ({
  version: entry.newVersion,
  filename: entry.filename,
  normalizedSqlSha256: normalizedHash(readFileSync(resolve("supabase/migrations", entry.filename), "utf8")),
}));
const domains = JSON.parse(process.env.UAT_DOMAIN_RESULTS ?? "{}");
const report = {
  schemaVersion: 1,
  baseline: { runId: process.env.BASELINE_RUN, schemaSha256: process.env.BASELINE_SHA256 },
  postgresImage: process.env.PG17_IMAGE,
  testCommit: process.env.GITHUB_SHA ?? null,
  migrations,
  domains,
  blockers: Object.entries(domains)
    .filter(([, result]) => result !== "success")
    .map(([domain, result]) => ({ code: "DOMAIN_NOT_PASSED", domain, result })),
};
report.reportSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
