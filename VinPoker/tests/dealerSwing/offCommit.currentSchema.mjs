import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.ok(process.env.PGDATABASE?.startsWith("vinpoker_ops_"));
const fixture = readFileSync("tests/dealerSwing/operationalInventory.pg17.sql", "utf8");
assert.equal((fixture.match(/ROLLBACK;/g) ?? []).length, 1);
const manual = `SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);`;
const query = fixture.replace("BEGIN;", `BEGIN; ${manual}`).replace("ROLLBACK;",
  () => readFileSync("tests/dealerSwing/offCommitCurrentSchema.pg17.sql", "utf8") + "\nROLLBACK;")
  .replaceAll('e1700000-', 'e2200000-')
  .replaceAll("'exact-key'", "'off-fence-exact-key'");
const result = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
console.log("Current-schema real initial-assignment RPC, manual-OFF, denied actor, receipt replay and autoON PASS");
