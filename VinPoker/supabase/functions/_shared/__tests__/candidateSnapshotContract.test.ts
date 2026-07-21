import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

async function source(relativePath: string): Promise<string> {
  return await Deno.readTextFile(new URL(relativePath, import.meta.url));
}

Deno.test("candidate snapshot callers cannot destructure candidates before checking status", async () => {
  const directCandidateCallers = await Promise.all([
    source("../pickNextDealer.ts"),
    source("../../process-swing/passes/pass1.5-rotation-planner.ts"),
    source("../fillOpenOperation.ts"),
  ]);

  for (const caller of directCandidateCallers) {
    assertNotMatch(
      caller,
      /const\s*\{\s*candidates[^}]*\}\s*=\s*await\s+buildDealerCandidates\s*\(/,
    );
  }

  const [pickNextSource, pass15Source, fillOpenSource] = directCandidateCallers;
  assertMatch(pickNextSource, /function requireCandidateSnapshot\(/);
  assertMatch(pass15Source, /if \(candidateResult\.status !== "ok"\)/);
  assertMatch(fillOpenSource, /if \(snapshotResult\.status !== "ok"\)/);
});

Deno.test("rotation and empty-table callers preserve non-ok candidate status", async () => {
  const [passRSource, passS2Source, fillEmptySource, processSwingSource] = await Promise.all([
    source("../../process-swing/passes/passR-rotation-planner.ts"),
    source("../../process-swing/passes/passS2-empty-table-preassign.ts"),
    source("../fillEmptyTables.ts"),
    source("../../process-swing/index.ts"),
  ]);

  assertMatch(passRSource, /if \(supplyResult\.status !== "ok"\)/);
  assertMatch(passS2Source, /if \(supplyResult\.status !== "ok"\)/);
  assertMatch(fillEmptySource, /if \(pickResult\.status !== "ok"\)/);
  assert(!/const\s*\{\s*supply[^}]*\}\s*=\s*await\s+buildRotationSupply\s*\(/.test(passRSource));
  assert(!/const\s*\{\s*supply[^}]*\}\s*=\s*await\s+buildRotationSupply\s*\(/.test(passS2Source));
  assertMatch(
    processSwingSource,
    /if \(p15Result\.candidateStatus\)[\s\S]{0,1000}recordDispatchSafetyOutcome[\s\S]{0,1000}continue;/,
  );
  assertMatch(
    processSwingSource,
    /if \(passRResult\.candidateStatus\)[\s\S]{0,1000}recordDispatchSafetyOutcome[\s\S]{0,1000}continue;/,
  );
});
