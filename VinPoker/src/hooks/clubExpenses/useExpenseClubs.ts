import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mockExpenseClubs } from "@/lib/clubExpenses/mockExpenses";
import type { ClubExpenseSource, ExpenseClub } from "@/lib/clubExpenses/types";

const db = supabase as unknown as { from: (table: string) => any };

export function useExpenseClubs(source: ClubExpenseSource, enabled: boolean) {
  const { user, loading: authLoading, isAdmin, isClubAdmin } = useAuth();

  return useQuery({
    queryKey: ["clubExpenses", "clubs", source, user?.id ?? "anon"],
    enabled: enabled && !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    queryFn: async (): Promise<ExpenseClub[]> => {
      if (source === "mock") return mockExpenseClubs();
      if (!user) return [];

      if (isAdmin || isClubAdmin) {
        const { data, error } = await db.from("clubs").select("id,name").order("name").limit(50);
        if (error) throw error;
        return (data ?? []).map((c: any) => ({ id: c.id, name: c.name ?? c.id }));
      }

      const [{ data: owned, error: ownedError }, { data: cashierRows, error: cashierError }] = await Promise.all([
        db.from("clubs").select("id,name").eq("owner_id", user.id),
        db.from("club_cashiers").select("club_id").eq("user_id", user.id),
      ]);
      if (ownedError) throw ownedError;
      if (cashierError) throw cashierError;

      const clubs = new Map<string, ExpenseClub>();
      for (const c of owned ?? []) clubs.set(c.id, { id: c.id, name: c.name ?? c.id });
      const cashierIds = (cashierRows ?? []).map((r: any) => r.club_id).filter(Boolean);
      const missingIds = cashierIds.filter((id: string) => !clubs.has(id));
      if (missingIds.length) {
        const { data: cashierClubs, error } = await db.from("clubs").select("id,name").in("id", missingIds);
        if (error) throw error;
        for (const c of cashierClubs ?? []) clubs.set(c.id, { id: c.id, name: c.name ?? c.id });
      }

      return Array.from(clubs.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

