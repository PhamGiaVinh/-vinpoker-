import { supabase } from "@/integrations/supabase/client";

/**
 * Returns only club ids granted by server-side owner/cashier/floor membership.
 * UI checks are affordances; every write remains authorized again inside its RPC.
 */
export async function getFloorOperatorClubIds(userId: string): Promise<string[]> {
  const [cashierResult, floorResult] = await Promise.all([
    supabase.rpc("cashier_club_ids", { _user_id: userId }),
    supabase.rpc("floor_club_ids", { _user_id: userId }),
  ]);
  const accessError = cashierResult.error ?? floorResult.error;
  if (accessError) throw accessError;
  return Array.from(new Set([...(cashierResult.data ?? []), ...(floorResult.data ?? [])]));
}
