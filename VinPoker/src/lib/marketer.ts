import { FEATURES } from "@/lib/featureFlags";

/**
 * Derive whether a user is a Marketer of any club (membership in `club_marketers`).
 *
 * P0 SAFETY (do not weaken): `club_marketers` ships source-only (migration 20261101000001) and
 * is NOT applied live until a controlled DB session. `useAuth` runs for EVERY user on every
 * load, so this MUST NOT query the table until the feature is enabled and MUST never throw — an
 * unguarded query would `42P01` for all users before the table exists. Therefore this helper:
 *   - returns false synchronously (NO query) when `FEATURES.marketingModule` is off or there is
 *     no user;
 *   - swallows any error result / thrown rejection and returns false.
 * It never affects any other auth derivation and adds no latency while the flag is off. This is
 * the exact pattern used by `deriveIsChipMaster` (see lib/chipMaster.ts).
 *
 * The `opts` seam exists only for unit testing (inject a fake client / force `enabled`).
 */
export async function deriveIsMarketing(
  userId: string | null | undefined,
  opts?: { client?: any; enabled?: boolean },
): Promise<boolean> {
  const enabled = opts?.enabled ?? FEATURES.marketingModule;
  if (!enabled || !userId) return false;
  // Import the real client lazily (only when not injected) so the flag-off path never touches
  // it and unit tests can run without the Vite Supabase env.
  const client: any = opts?.client ?? (await import("@/integrations/supabase/client")).supabase;
  try {
    const { data, error } = await client
      .from("club_marketers")
      .select("club_id")
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
