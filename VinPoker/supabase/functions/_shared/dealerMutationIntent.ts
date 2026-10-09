import { isUuid } from "./internal-trigger-auth.ts";

/** Actor must come from authenticateUser/getUser, never from the request body. */
export function manualDealerIntentHeaders(authenticatedActor: string): Record<string, string> {
  if (!isUuid(authenticatedActor)) throw new Error("DEALER_MANUAL_ACTOR_REQUIRED");
  return { "x-vinpoker-dealer-intent": "manual", "x-vinpoker-dealer-actor": authenticatedActor };
}
