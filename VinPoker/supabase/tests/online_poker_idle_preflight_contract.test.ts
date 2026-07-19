import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL(
    "../migrations/20270103000002_online_poker_idle_preflight.sql",
    import.meta.url,
  ),
);

function functionBody(name: string): string {
  const start = migration.indexOf(
    `CREATE OR REPLACE FUNCTION public.${name}()`,
  );
  assert(start >= 0, `${name} definition missing`);
  const end = migration.indexOf("\n$$;", migration.indexOf("AS $$", start));
  assert(end > start, `${name} definition is incomplete`);
  return migration.slice(start, end);
}

Deno.test("table runner preflights before Vault and HTTP", () => {
  const body = functionBody("op_run_table_runner");
  const preflight = body.indexOf("op_run_due_table_ticks(1)");
  const vault = body.indexOf("FROM vault.decrypted_secrets");
  const http = body.indexOf("net.http_post(");
  assert(preflight >= 0);
  assert(preflight < vault);
  assert(vault < http);
  assertStringIncludes(body, "jsonb_array_length(v_preflight->'tables') = 0");
});

Deno.test("timeout sweep preflights expired hands before Vault and HTTP", () => {
  const body = functionBody("op_run_timeout_sweep");
  const preflight = body.indexOf("public.op_timeout_sweep()");
  const vault = body.indexOf("FROM vault.decrypted_secrets");
  const http = body.indexOf("net.http_post(");
  assert(preflight >= 0);
  assert(preflight < vault);
  assert(vault < http);
  assertStringIncludes(body, "jsonb_array_length(v_preflight->'hands') = 0");
});

Deno.test("migration preserves schedules and existing Edge contracts", () => {
  assertEquals(migration.includes("cron.schedule"), false);
  assertEquals(migration.includes("cron.unschedule"), false);
  assertStringIncludes(migration, "online-poker-table-runner");
  assertStringIncludes(migration, "online-poker-timeout-sweep");
  assertStringIncludes(migration, "timeout_milliseconds := 5000");
});

Deno.test("idle branches return before secret reads", () => {
  for (const name of ["op_run_table_runner", "op_run_timeout_sweep"]) {
    const body = functionBody(name);
    assert(
      body.indexOf("RETURN NULL;") <
        body.indexOf("FROM vault.decrypted_secrets"),
    );
  }
});
