import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";

export type FnbLinkTable = { id: string; table_name: string; status: string };
export type FnbLinkPlayer = {
  player_id: string; name: string; table_id: string | null; table_name: string | null; seat_number: number;
};
export type FnbLinkTargets = { tables: FnbLinkTable[]; players: FnbLinkPlayer[] };

/**
 * A2 picker data source — reads real club tables + seated players in the club's LIVE tournaments via
 * the SECURITY DEFINER `fnb_list_link_targets` RPC. F&B cashiers cannot read `game_tables` /
 * `tournament_tables` directly under RLS (gated to dealer-control/admin/owner); this RPC reads them on
 * the caller's behalf without widening any RLS policy. Reporting labels ONLY — no chip/bank/debt data.
 * `players` is empty when the club has no live tournament right now; the table list always works.
 */
export function useFnbLinkTargets(clubId: string | undefined) {
  return useQuery({
    queryKey: ["fnb", "linkTargets", clubId],
    enabled: !!clubId && FEATURES.fnbTableLink,
    queryFn: async (): Promise<FnbLinkTargets> => {
      const { data, error } = await (supabase.rpc as any)("fnb_list_link_targets", { p_club_id: clubId });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);
      return { tables: (res?.tables ?? []) as FnbLinkTable[], players: (res?.players ?? []) as FnbLinkPlayer[] };
    },
  });
}
