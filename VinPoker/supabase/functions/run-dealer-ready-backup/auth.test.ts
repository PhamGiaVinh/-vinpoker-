import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("backup HTTP handler rejects untrusted requests before privileged client construction", async () => {
  const oldServe = Deno.serve;
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldInternal = Deno.env.get("PROCESS_SWING_INTERNAL_SECRET");
  let handler: (req: Request) => Promise<Response>;
  // Capture the real deployed handler without binding a port or creating a backend client.
  Object.defineProperty(Deno, "serve", { configurable: true, value: (fn: typeof handler) => { handler = fn; } });
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "backup-handler-test-fixture");
  Deno.env.set("SUPABASE_URL", "");
  Deno.env.delete("PROCESS_SWING_INTERNAL_SECRET");
  try {
    await import("./index.ts");
    for (const token of ["anything", "public-anon-fixture", "browser-user-fixture"]) {
      const response = await handler!(new Request("https://worker.invalid", {
        method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}",
      }));
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "internal_auth_denied" });
    }
    const methodResponse = await handler!(new Request("https://worker.invalid", { method: "GET" }));
    assertEquals(methodResponse.status, 405);
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    const response = await handler!(new Request("https://worker.invalid", { method: "POST" }));
    assertEquals(response.status, 503);
  } finally {
    Object.defineProperty(Deno, "serve", { configurable: true, value: oldServe });
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldInternal === undefined) Deno.env.delete("PROCESS_SWING_INTERNAL_SECRET");
    else Deno.env.set("PROCESS_SWING_INTERNAL_SECRET", oldInternal);
  }
});
