import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeSwingWorkerRequest } from "../internal-trigger-auth.ts";

Deno.test("backup worker rejects arbitrary Bearer, anon and browser credentials", () => {
  for (const header of ["", "Bearer ", "Bearer public-anon-fixture", "Bearer browser-user-fixture", "Basic service-fixture"]) {
    const request = new Request("https://worker.invalid", { headers: { authorization: header } });
    assertEquals(authorizeSwingWorkerRequest(request, "service-fixture", "internal-fixture"), {
      ok: false, status: 401, code: "internal_auth_denied",
    });
  }
});

Deno.test("backup worker accepts only exact provisioned service credential and fails closed without it", () => {
  const request = new Request("https://worker.invalid", { headers: { authorization: "Bearer service-fixture" } });
  assertEquals(authorizeSwingWorkerRequest(request, "service-fixture", ""), { ok: true });
  assertEquals(authorizeSwingWorkerRequest(request, "", ""), { ok: false, status: 503, code: "internal_auth_not_configured" });
  assertEquals(authorizeSwingWorkerRequest(request, "service-fixture-other", ""), { ok: false, status: 401, code: "internal_auth_denied" });
});

Deno.test("backup worker accepts provisioned Swing internal secret, never a public fallback", () => {
  const request = new Request("https://worker.invalid", { headers: { authorization: "Bearer internal-fixture" } });
  assertEquals(authorizeSwingWorkerRequest(request, "", "internal-fixture"), { ok: true });
  assertEquals(authorizeSwingWorkerRequest(request, "service-fixture", "wrong-internal"), { ok: false, status: 401, code: "internal_auth_denied" });
});
