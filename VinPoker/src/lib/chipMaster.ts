import { FEATURES } from "@/lib/featureFlags";

/**
 * Derive whether a user is a Chip-Master of any club (membership in `club_chip_masters`).
 *
 * P0 SAFETY (do not weaken): `club_chip_masters` ships source-only (migration
 * 20261016000000) and is NOT applied live until a controlled DB session. `useAuth` runs for
 * EVERY user on every load, so this MUST NOT query the table until the feature is enabled and
 * MUST never throw — an unguarded query would `42P01` for all users before the table exists.
 * Therefore this helper:
 *   - returns false synchronously (NO query) when `FEATURES.chipOps` is off or there is no user;
 *   - swallows any error result / thrown rejection and returns false.
 * It never affects any other auth derivation and adds no latency while the flag is off.
 *
 * The `opts` seam exists only for unit testing (inject a fake client / force `enabled`).
 */
export async function deriveIsChipMaster(
  userId: string | null | undefined,
  opts?: { client?: any; enabled?: boolean },
): Promise<boolean> {
  const enabled = opts?.enabled ?? FEATURES.chipOps;
  if (!enabled || !userId) return false;
  // Import the real client lazily (only when not injected) so the flag-off path never touches
  // it and unit tests can run without the Vite Supabase env.
  const client: any = opts?.client ?? (await import("@/integrations/supabase/client")).supabase;
  try {
    const { data, error } = await client
      .from("club_chip_masters")
      .select("club_id")
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
