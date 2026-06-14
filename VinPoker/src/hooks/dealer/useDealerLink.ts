import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { mockDealerProfile } from "@/lib/dealerApp/mockDealerData";
import type { DealerDataSource, DealerProfileView } from "@/types/dealerApp";

// dealer_shift_* / live reads go through an untyped client (same pattern as
// useShiftPlanner) since these joins aren't in the generated types yet.
const db = supabase as unknown as { from: (table: string) => any };

function embeddedName(clubs: any): string {
  if (!clubs) return "";
  return Array.isArray(clubs) ? (clubs[0]?.name ?? "") : (clubs.name ?? "");
}

export interface UseDealerLinkResult {
  dealer: DealerProfileView | null;
  isDealer: boolean;
  loading: boolean;
  source: DealerDataSource;
}

/**
 * Resolves the current user's dealer-employment record (dealers.user_id =
 * auth.uid()), enriched with open-market identity from `profiles` (region /
 * verification / avatar). In mock mode it always returns a demo dealer so the app
 * is browsable with no DB / no login. READ ONLY — planner/profiles only.
 */
export function useDealerLink(): UseDealerLinkResult {
  const { user, loading: authLoading } = useAuth();
  const source = dealerDataSource();

  const q = useQuery({
    queryKey: dealerKeys.link(user?.id),
    enabled: !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    queryFn: async (): Promise<DealerProfileView | null> => {
      if (source === "mock") return mockDealerProfile();
      if (!user) return null;

      const { data, error } = await db
        .from("dealers")
        .select("id, club_id, user_id, full_name, tier, status, clubs(name)")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const { data: prof } = await db
        .from("profiles")
        .select("region, avatar_url, is_verified")
        .eq("user_id", user.id)
        .maybeSingle();

      return {
        dealerId: data.id,
        userId: data.user_id,
        clubId: data.club_id,
        clubName: embeddedName(data.clubs),
        fullName: data.full_name,
        tier: data.tier,
        status: data.status,
        region: prof?.region ?? null,
        avatarUrl: prof?.avatar_url ?? null,
        isVerified: !!prof?.is_verified,
      };
    },
  });

  return {
    dealer: q.data ?? null,
    isDealer: !!q.data,
    loading: authLoading || q.isLoading,
    source,
  };
}
