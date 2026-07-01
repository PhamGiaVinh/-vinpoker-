import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FnbReportTopItem = { menuItemId: string; name: string; qty: number; revenue: number };
export type FnbReportLowStock = { ingredientId: string; name: string; onHand: number; threshold: number; unit: string };
export type FnbReportDailyPoint = { date: string; revenue: number; cogs: number };
export type FnbReportGroup = { tableRef?: string | null; playerRef?: string | null; name: string; revenue: number; cogs: number; count: number };

export type FnbReport = {
  revenue: number; cogs: number; grossProfit: number; orderCount: number;
  statusCounts: Record<string, number>;
  topItems: FnbReportTopItem[];
  lowStock: FnbReportLowStock[];
  dailyTrend: FnbReportDailyPoint[];
  compCount: number; compCogs: number;
  byTable: FnbReportGroup[];
  byPlayer: FnbReportGroup[];
};

/**
 * F&B report (A2) — reads `fnb_get_report(p_from,p_to,p_club_id)`. `from`/`to` are ISO timestamptz
 * strings (caller picks the range). Comps are already excluded from `revenue`/`cogs`/`byTable`/
 * `byPlayer` — they surface separately via `compCount`/`compCogs`. `byTable`/`byPlayer` entries with a
 * null ref represent "Khách lẻ" (walk-in, no table/player picked).
 */
export function useFnbReport(clubId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["fnb", "report", clubId, from, to],
    enabled: !!clubId,
    queryFn: async (): Promise<FnbReport> => {
      const { data, error } = await (supabase.rpc as any)("fnb_get_report", {
        p_from: from, p_to: to, p_club_id: clubId,
      });
      if (error) throw error;
      return data as FnbReport;
    },
  });
}
