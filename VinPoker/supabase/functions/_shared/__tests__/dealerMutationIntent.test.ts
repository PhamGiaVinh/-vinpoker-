import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { manualDealerIntentHeaders } from "../dealerMutationIntent.ts";

Deno.test("manual dealer context carries a validated authenticated actor, not a key prefix", () => {
  const actor = "22000000-0000-4000-8000-000000000002";
  assertEquals(manualDealerIntentHeaders(actor), {
    "x-vinpoker-dealer-intent": "manual", "x-vinpoker-dealer-actor": actor,
  });
  for (const invalid of ["", "manual_abc", "service_role", "not-a-user"]) {
    assertThrows(() => manualDealerIntentHeaders(invalid), Error, "DEALER_MANUAL_ACTOR_REQUIRED");
  }
});
