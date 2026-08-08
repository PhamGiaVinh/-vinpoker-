import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FORBIDDEN_DIRECT_WRITES = [
  /\.from\(\s*["']tournaments["']\s*\)\s*\.(?:insert|update|delete)\s*\(/u,
  /\.from\(\s*["'](?:payments|tournament_prize_payments|staking_[^"']*|sepay_[^"']*)["']\s*\)\s*\.(?:insert|update|upsert|delete)\s*\(/u,
  /(?:paid|is_paid)\s*[:=]\s*true/u,
];

const FORBIDDEN_DIRECT_TOURNAMENT_DELETE =
  /\.from\(\s*["']tournaments["']\s*\)[\s\S]{0,120}\.delete\(\s*\)/u;

const REQUIRED_RPC_NAMES = [
  "ops_create_tournament",
  "ops_update_tournament",
  "ops_update_tournament_live",
  "ops_delete_tournament_safe",
  "ops_create_offline_buyin_and_seat",
];

export async function scanOpsMoneyBoundary(repositoryRoot) {
  const files = [
    path.join(repositoryRoot, "src", "ops", "opsMutations.ts"),
    path.join(repositoryRoot, "src", "pages", "ops", "OpsCashier.tsx"),
    path.join(repositoryRoot, "src", "components", "cashier", "OfflineBuyInPanel.tsx"),
  ];
  const deleteCallerFiles = [
    path.join(repositoryRoot, "src", "components", "floor", "useFloorTournaments.ts"),
    path.join(repositoryRoot, "src", "hooks", "useTournaments.ts"),
    path.join(repositoryRoot, "src", "pages", "SuperAdmin.tsx"),
  ];
  const findings = [];
  const canonicalMigration = path.join(
    repositoryRoot,
    "supabase",
    "migrations",
    "20270109000000_ops_floor_cashier_canonical_mutations.sql",
  );
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of FORBIDDEN_DIRECT_WRITES) {
      if (pattern.test(source)) findings.push(`${path.relative(repositoryRoot, file)}:${pattern}`);
    }
    if (file.endsWith("opsMutations.ts")) {
      for (const name of REQUIRED_RPC_NAMES) {
        if (!source.includes(`rpc(\"${name}\"`)) findings.push(`missing_rpc:${name}`);
      }
      if (source.includes('rpc("create_offline_buyin_and_seat"')) findings.push("legacy_buyin_rpc");
    }
  }
  for (const file of deleteCallerFiles) {
    const source = await readFile(file, "utf8");
    if (FORBIDDEN_DIRECT_TOURNAMENT_DELETE.test(source)) {
      findings.push(`${path.relative(repositoryRoot, file)}:direct_tournament_delete`);
    }
  }
  const migrationSource = await readFile(canonicalMigration, "utf8");
  const authenticatedGrant = /GRANT\s+EXECUTE[\s\S]{0,220}ops_create_offline_buyin_and_seat[\s\S]{0,220}\bTO\s+authenticated\b/iu;
  if (authenticatedGrant.test(migrationSource)) {
    findings.push("new_offline_buyin_authenticated_grant");
  }
  const canonicalRevoke = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.ops_create_offline_buyin_and_seat\s*\(uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/iu;
  if (!canonicalRevoke.test(migrationSource)) {
    findings.push("new_offline_buyin_acl_revoke_missing");
  }
  return findings;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const rootFlag = process.argv.indexOf("--root");
    const root = path.resolve(rootFlag >= 0 ? process.argv[rootFlag + 1] : process.cwd());
    const findings = await scanOpsMoneyBoundary(root);
    if (findings.length) {
      for (const finding of findings) process.stderr.write(`OPS_MONEY_BOUNDARY_FAIL ${finding}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("OPS_MONEY_BOUNDARY_PASS\n");
    }
  } catch (error) {
    process.stderr.write(`OPS_MONEY_BOUNDARY_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
