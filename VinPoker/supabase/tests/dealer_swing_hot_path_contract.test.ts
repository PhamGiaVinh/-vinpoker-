import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const edge = await Deno.readTextFile(
  new URL("../functions/process-swing/index.ts", import.meta.url),
);
const plannerMigration = await Deno.readTextFile(
  new URL(
    "../migrations/20270103000000_upsert_rotation_plan_diff.sql",
    import.meta.url,
  ),
);
const cronMigration = await Deno.readTextFile(
  new URL(
    "../migrations/20270103000001_process_swing_cron_work_filter.sql",
    import.meta.url,
  ),
);

Deno.test("global pool summary refresh occurs once after the club loop", () => {
  assertEquals(
    edge.match(/rpc\("refresh_dealer_pool_summary"\)/g)?.length ?? 0,
    1,
  );
  assert(
    edge.indexOf('rpc("refresh_dealer_pool_summary")') >
      edge.indexOf("} // END club processing loop"),
  );
  assertStringIncludes(edge, "if (!dryRun && clubsProcessed > 0)");
});

Deno.test("explicit empty club scope does not fall back to all clubs", () => {
  assertStringIncludes(edge, "requestedClubIds !== undefined");
  assertStringIncludes(edge, "clubIds = requestedClubIds");
  assertStringIncludes(edge, "club_ids is restricted to internal callers");
});

Deno.test("planner uses serialized semantic diff and predicted-only updates", () => {
  assertStringIncludes(plannerMigration, "pg_advisory_xact_lock");
  assertStringIncludes(plannerMigration, "'unchanged', v_unchanged");
  assertStringIncludes(plannerMigration, "score and reason can drift");
  assertStringIncludes(plannerMigration, "s.status = 'predicted'");
  assertStringIncludes(plannerMigration, "ON CONFLICT DO NOTHING");
  assert(
    !/UPDATE public\.dealer_rotation_schedule[\s\S]*status IN \('announced', 'executing'\)/
      .test(plannerMigration),
  );
});

Deno.test("cron proves work before Vault and HTTP", () => {
  const workCheck = cronMigration.indexOf("get_process_swing_due_club_ids();");
  const vaultRead = cronMigration.indexOf("FROM vault.decrypted_secrets");
  const httpCall = cronMigration.indexOf("net.http_post(");
  assert(workCheck >= 0);
  assert(workCheck < vaultRead);
  assert(vaultRead < httpCall);
  assertStringIncludes(
    cronMigration,
    "body := jsonb_build_object('club_ids', v_club_ids)",
  );
});
