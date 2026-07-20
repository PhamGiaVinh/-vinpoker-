import { assertEquals } from "jsr:@std/assert@1";
import { fillEmptyTables } from "../fillEmptyTables.ts";

function failingAdmin(code: string, message: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "or", "gte", "gt", "not", "order"]) {
    query[method] = () => query;
  }
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: null, error: { code, message } }).then(resolve, reject);
  return { from: () => query };
}

Deno.test("fillEmptyTables reports a missing operation column as dependency_unavailable", async () => {
  const result = await fillEmptyTables(
    failingAdmin("42703", "column game_tables.dealer_open_operation_id does not exist"),
    "22222222-2222-2222-2222-222222222222",
    undefined,
    "",
  );
  assertEquals(result.status, "dependency_unavailable");
  assertEquals(result.error_code, "active_tables_dependency_unavailable");
  assertEquals(result.assignments, []);
});

Deno.test("fillEmptyTables reports PostgREST schema-cache drift explicitly", async () => {
  const result = await fillEmptyTables(
    failingAdmin("PGRST204", "Could not find the column in the schema cache"),
    "22222222-2222-2222-2222-222222222222",
    undefined,
    "",
  );
  assertEquals(result.status, "dependency_unavailable");
  assertEquals(result.assignments, []);
});

Deno.test("fillEmptyTables does not convert an unknown query failure into an empty pool", async () => {
  const result = await fillEmptyTables(
    failingAdmin("XX000", "connection interrupted"),
    "22222222-2222-2222-2222-222222222222",
    undefined,
    "",
  );
  assertEquals(result.status, "query_failed");
  assertEquals(result.error_code, "active_tables_query_failed");
  assertEquals(result.assignments, []);
});

Deno.test("fillEmptyTables treats no active tables as an empty successful workload", async () => {
  let fromCalls = 0;
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  const admin = {
    from: () => {
      fromCalls += 1;
      if (fromCalls > 1) throw new Error("unexpected follow-up query");
      return query;
    },
  };

  const result = await fillEmptyTables(
    admin,
    "22222222-2222-2222-2222-222222222222",
    undefined,
    "",
  );
  assertEquals(result.status, "ok");
  assertEquals(result.assignments, []);
  assertEquals(fromCalls, 1);
});
