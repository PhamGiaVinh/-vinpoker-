import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const functionsSql = await Deno.readTextFile(
  new URL(
    "../migrations/20270103000003_retention_cleanup_functions.sql",
    import.meta.url,
  ),
);
const schedulesSql = await Deno.readTextFile(
  new URL(
    "../migrations/20270103000004_retention_cleanup_schedules.sql",
    import.meta.url,
  ),
);
const indexSql = await Deno.readTextFile(
  new URL(
    "../maintenance/20270103000000_cron_run_details_index.sql",
    import.meta.url,
  ),
);
const vacuumSql = await Deno.readTextFile(
  new URL(
    "../maintenance/20270103000001_retention_post_cleanup_vacuum.sql",
    import.meta.url,
  ),
);
const repackSql = await Deno.readTextFile(
  new URL(
    "../maintenance/20270103000002_pg_repack_assessment.sql",
    import.meta.url,
  ),
);

Deno.test("all automatic deletes are hard-capped and lock-safe", () => {
  assert(
    (functionsSql.match(/LEAST\(GREATEST\(COALESCE\(p_batch_size/g)?.length ??
      0) >= 6,
  );
  assert((functionsSql.match(/FOR UPDATE SKIP LOCKED/g)?.length ?? 0) >= 4);
  assertStringIncludes(functionsSql, "5000");
  assertEquals(/\bTRUNCATE\b/i.test(functionsSql), false);
  assertEquals(/VACUUM\s+FULL/i.test(functionsSql), false);
});

Deno.test("rotation and cron live states are excluded from eligibility", () => {
  assertStringIncludes(
    functionsSql,
    "s.status IN ('executed', 'cancelled', 'no_show')",
  );
  assertStringIncludes(functionsSql, "s.status = 'superseded'");
  assertStringIncludes(functionsSql, "d.end_time IS NOT NULL");
  assertStringIncludes(
    functionsSql,
    "d.status NOT IN ('running', 'connecting')",
  );
  assertEquals(
    /DELETE[\s\S]{0,500}status\s+IN\s*\('predicted',\s*'announced',\s*'executing'\)/i
      .test(functionsSql),
    false,
  );
});

Deno.test("schedule activation fails closed without the concurrent index", () => {
  assertStringIncludes(
    schedulesSql,
    "to_regclass('cron.idx_job_run_details_start_time')",
  );
  assertEquals(schedulesSql.match(/SELECT cron\.schedule\(/g)?.length ?? 0, 4);
  for (const minute of ["7", "17", "27", "37"]) {
    assertStringIncludes(schedulesSql, `'${minute} * * * *'`);
  }
});

Deno.test("index and vacuum are explicit non-transactional owner steps", () => {
  assertStringIncludes(indexSql, "CREATE INDEX CONCURRENTLY IF NOT EXISTS");
  assertEquals(/^\s*BEGIN\b/im.test(indexSql), false);
  assertEquals(vacuumSql.match(/VACUUM \(ANALYZE\)/g)?.length ?? 0, 4);
  assertEquals(
    /^\s*VACUUM[^(]*\(.*net\._http_response/im.test(vacuumSql),
    false,
  );
});

Deno.test("pg_repack assessment requires twice the live relation size", () => {
  assertStringIncludes(repackSql, "total_bytes * 2");
  assertStringIncludes(repackSql, "pg_available_extensions");
  assertStringIncludes(repackSql, "public.dealer_rotation_schedule");
  assertStringIncludes(repackSql, "cron.job_run_details");
});
