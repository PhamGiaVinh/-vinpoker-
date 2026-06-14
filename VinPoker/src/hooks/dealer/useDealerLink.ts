import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { mockDealerMemberships } from "@/lib/dealerApp/mockDealerData";
import { useSelectedDealerId, setSelectedDealerId } from "@/lib/dealerApp/selectedClub";
import type { DealerDataSource, DealerProfileView } from "@/types/dealerApp";

// dealer_shift_* / live reads go through an untyped client (same pattern as
// useShiftPlanner) since these joins aren't in the generated types yet.
const db = supabase as unknown as { from: (table: string) => any };

function embeddedName(clubs: any): string {
  if (!clubs) return "";
  return Array.isArray(clubs) ? (clubs[0]?.name ?? "") : (clubs.name ?? "");
}

export interface UseDealerLinkResult {
  /** The currently-selected membership (multi-club aware). */
  dealer: DealerProfileView | null;
  /** ALL dealer rows linked to this user — one per club. */
  memberships: DealerProfileView[];
  selectedDealerId: string | null;
  setSelectedDealerId: (id: string) => void;
  isDealer: boolean;
  loading: boolean;
  source: DealerDataSource;
}

/**
 * Resolves the current user's dealer memberships. A single auth.uid() may be a
 * dealer of multiple clubs (multiple `dealers` rows), so this returns the full
 * list plus the selected one; `dealer` is the active membership (back-compat).
 * Enriched with open-market identity from `profiles` (region / verification /
 * avatar). In mock mode it returns two demo clubs so the switcher is browsable
 * with no DB / no login. READ ONLY — dealers / profiles only.
 */
export function useDealerLink(): UseDealerLinkResult {
  const { user, loading: authLoading } = useAuth();
  const source = dealerDataSource();
  const selectedId = useSelectedDealerId();

  const q = useQuery({
    queryKey: dealerKeys.link(user?.id),
    enabled: !authLoading && (source === "mock" || !!user),
    staleTime: 60_000,
    queryFn: async (): Promise<DealerProfileView[]> => {
      if (source === "mock") return mockDealerMemberships();
      if (!user) return [];

      const { data, error } = await db
        .from("dealers")
        .select("id, club_id, user_id, full_name, tier, status, clubs(name)")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("full_name");
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: prof } = await db
        .from("profiles")
        .select("region, avatar_url, is_verified")
        .eq("user_id", user.id)
        .maybeSingle();

      return rows.map(
        (d: any): DealerProfileView => ({
          dealerId: d.id,
          userId: d.user_id,
          clubId: d.club_id,
          clubName: embeddedName(d.clubs),
          fullName: d.full_name,
          tier: d.tier,
          status: d.status,
          region: prof?.region ?? null,
          avatarUrl: prof?.avatar_url ?? null,
          isVerified: !!prof?.is_verified,
        })
      );
    },
  });

  const memberships = q.data ?? [];
  const dealer = memberships.find((m) => m.dealerId === selectedId) ?? memberships[0] ?? null;

  // Default / reconcile the selection when memberships load or change.
  useEffect(() => {
    if (memberships.length === 0) return;
    if (!selectedId || !memberships.some((m) => m.dealerId === selectedId)) {
      setSelectedDealerId(memberships[0].dealerId);
    }
  }, [memberships, selectedId]);

  return {
    dealer,
    memberships,
    selectedDealerId: dealer?.dealerId ?? null,
    setSelectedDealerId,
    isDealer: memberships.length > 0,
    loading: authLoading || q.isLoading,
    source,
  };
}
