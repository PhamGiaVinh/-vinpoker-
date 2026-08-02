import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectFloorWorkspaceBoundary } from "./check-floor-workspace-boundary.mjs";

async function fixture(floorSource, payoutSource = "export default function PayoutWorkspace(){}") {
  const root = await mkdtemp(path.join(os.tmpdir(), "floor-workspace-boundary-"));
  await mkdir(path.join(root, "src", "ops", "floor"), { recursive: true });
  await writeFile(path.join(root, "src", "ops", "floor", "Example.tsx"), floorSource);
  await writeFile(path.join(root, "src", "ops", "floor", "PayoutWorkspace.tsx"), payoutSource);
  await writeFile(
    path.join(root, "src", "OpsApp.tsx"),
    '"/ops/floor";"tables";"players";"clock";"payout";"screens";',
  );
  return root;
}

test("accepts provider-owned Floor source and read-only payout", async () => {
  const root = await fixture(
    'import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";',
  );
  try {
    const result = await inspectFloorWorkspaceBoundary(root);
    assert.deepEqual(result.violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects global player client, history back, and direct payout seams", async () => {
  const root = await fixture(
    [
      'import { supabase } from "@/integrations/supabase/client";',
      "navigate(-1);",
      'supabase.rpc("record_tournament_prize_payment");',
    ].join("\n"),
    'client.functions.invoke("payment");',
  );
  try {
    const result = await inspectFloorWorkspaceBoundary(root);
    assert.deepEqual(
      result.violations.map((violation) => violation.rule).sort(),
      [
        "direct-prize-payment-rpc",
        "global-player-supabase-client",
        "history-dependent-back",
        "payout-workspace-mutation",
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when a canonical workspace route is absent", async () => {
  const root = await fixture("export const safe = true;");
  try {
    await writeFile(path.join(root, "src", "OpsApp.tsx"), '"/ops/floor";"tables";');
    const result = await inspectFloorWorkspaceBoundary(root);
    assert.ok(result.violations.some((violation) => violation.rule === "missing-route:players"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
