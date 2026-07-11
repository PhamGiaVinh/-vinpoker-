import { supabase } from "@/integrations/supabase/client";

/**
 * True if the user is a club_accountants member of ≥1 club (the salary chốt/duyệt role).
 * Guarded + default-false-safe: returns false on any error so it never blocks auth init.
 * NAV AFFORDANCE ONLY — every accountant data read/write is still gated server-side by the
 * SECURITY DEFINER RPCs (grant/is_club_accountant + the salary RPCs), so this is never a grant.
 */
export async function deriveIsAccountant(userId: string): Promise<boolean> {
  try {
    const { data, error } = await (supabase.from("club_accountants" as any) as any)
      .select("club_id")
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
