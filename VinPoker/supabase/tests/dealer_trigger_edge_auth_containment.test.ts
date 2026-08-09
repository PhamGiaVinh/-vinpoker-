import {
  authorizeInternalTrigger,
  getIdempotencyKey,
  isApprovedInternalPath,
  parseDealerReadyPayload,
  parsePushPayload,
} from "../functions/_shared/internal-trigger-auth.ts";

const testSecret = "local-disposable-internal-secret";
const validClubId = "11111111-1111-4111-8111-111111111111";
const validAttendanceId = "22222222-2222-4222-8222-222222222222";
const validUserId = "33333333-3333-4333-8333-333333333333";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(headers: HeadersInit = {}) {
  return new Request("https://example.test/functions/v1/internal", { headers });
}

Deno.test("internal trigger auth rejects missing, arbitrary bearer, legacy-key-shaped, and wrong secret headers", () => {
  const deniedHeaders: Array<Record<string, string>> = [
    {},
    { Authorization: "Bearer arbitrary-non-secret" },
    { Authorization: "Bearer token-shaped-but-not-authorized" },
    { "x-vinpoker-internal-secret": "wrong" },
  ];

  for (const headers of deniedHeaders) {
    const result = authorizeInternalTrigger(request(headers), testSecret);
    assert(!result.ok && result.status === 401, "untrusted request must be denied");
  }
});

Deno.test("internal trigger auth fails closed when the configured secret is unavailable", () => {
  const result = authorizeInternalTrigger(request({ "x-vinpoker-internal-secret": testSecret }), undefined);
  assert(!result.ok && result.status === 503 && result.code === "internal_auth_not_configured", "missing configuration must fail closed");
});

Deno.test("internal trigger auth accepts only the dedicated secret", () => {
  const result = authorizeInternalTrigger(request({ "x-vinpoker-internal-secret": testSecret }), testSecret);
  assert(result.ok, "matching dedicated secret must be accepted");
});

Deno.test("dealer-ready payload and idempotency validation reject spoofable input", () => {
  assert(parseDealerReadyPayload({ club_id: validClubId, attendance_id: validAttendanceId }) !== null, "valid UUID payload accepted");
  assert(parseDealerReadyPayload({ club_id: validClubId, attendance_id: "not-a-uuid" }) === null, "invalid attendance rejected");
  assert(getIdempotencyKey(request({ "x-idempotency-key": "dealer-ready:abc_123" })) !== null, "valid event identity accepted");
  assert(getIdempotencyKey(request({ "x-idempotency-key": "contains spaces" })) === null, "invalid event identity rejected");
});

Deno.test("push payload restricts arbitrary recipients, content length, and external URLs", () => {
  assert(parsePushPayload({ user_id: validUserId, heading: "Ready", message: "Dealer ready", url: "/tournaments" }) !== null, "valid internal push accepted");
  assert(parsePushPayload({ user_id: "not-a-uuid", heading: "Ready", message: "Dealer ready" }) === null, "arbitrary recipient rejected");
  assert(parsePushPayload({ user_id: validUserId, heading: "Ready", message: "Dealer ready", url: "https://attacker.example" }) === null, "external URL rejected");
  assert(!isApprovedInternalPath("//attacker.example"), "protocol-relative URL rejected");
});

Deno.test("edge sources authenticate before creating privileged or provider clients", async () => {
  const processSource = await Deno.readTextFile(new URL("../functions/process-swing-on-dealer-ready/index.ts", import.meta.url));
  const pushSource = await Deno.readTextFile(new URL("../functions/send-push-notification/index.ts", import.meta.url));

  assert(processSource.indexOf("authorizeInternalTrigger(req)") < processSource.indexOf("const admin = createClient"), "auth must precede service-role client creation");
  assert(pushSource.indexOf("authorizeInternalTrigger(req)") < pushSource.indexOf("Deno.env.get(\"ONESIGNAL_APP_ID\")"), "auth must precede provider configuration access");
  assert(!processSource.includes("Access-Control-Allow-Origin"), "internal dealer endpoint must not advertise browser CORS access");
});

Deno.test("migration removes literal credential fallbacks and preserves trigger predicates", async () => {
  const migration = await Deno.readTextFile(new URL("../migrations/20270106000004_dealer_trigger_edge_auth_containment.sql", import.meta.url));
  const credentialPattern = /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/;

  assert(!credentialPattern.test(migration), "migration must not contain a token-shaped literal");
  assert(migration.includes("vault.decrypted_secrets"), "migration must use Vault");
  assert(migration.includes("x-vinpoker-internal-secret"), "migration must send dedicated internal auth");
  assert(!migration.includes("current_setting("), "migration must not fall back to session settings");
  assert(!migration.includes("Authorization"), "migration must not send bearer authorization");
  assert(migration.includes("TG_OP = 'INSERT' AND NEW.current_state = 'available'"), "available INSERT predicate retained");
  assert(migration.includes("OLD.current_state IS DISTINCT FROM 'available'"), "available transition predicate retained");
  assert(migration.includes("REVOKE ALL ON FUNCTION public.notify_dealer_ready_v2() FROM PUBLIC"), "dealer trigger direct execute revoked");
  assert(migration.includes("REVOKE ALL ON FUNCTION public.fn_dispatch_push() FROM PUBLIC"), "push trigger direct execute revoked");
});

Deno.test("function configuration uses custom internal authentication for both affected paths", async () => {
  const config = await Deno.readTextFile(new URL("../config.toml", import.meta.url));
  assert(config.includes("[functions.process-swing-on-dealer-ready]\nverify_jwt = false"), "dealer function must use custom auth configuration");
  assert(config.includes("[functions.send-push-notification]\nverify_jwt = false"), "push function must use custom auth configuration");
});
