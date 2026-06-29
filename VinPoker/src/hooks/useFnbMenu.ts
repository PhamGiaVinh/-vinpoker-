import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FnbCategory = {
  id: string; club_id: string; name: string; sort_order: number; is_active: boolean;
};
export type FnbMenuItem = {
  id: string; club_id: string; category_id: string | null; name: string;
  price_vnd: number; is_active: boolean; image_url: string | null; sort_order: number;
};
export type FnbIngredient = {
  id: string; club_id: string; name: string; stock_unit: string; purchase_unit: string | null;
  units_per_purchase: number; on_hand: number; avg_unit_cost: number;
  low_stock_threshold: number; is_active: boolean; version: number;
};
export type FnbMenuData = {
  categories: FnbCategory[]; items: FnbMenuItem[]; ingredients: FnbIngredient[];
};

/**
 * Reads the club's F&B catalogue (categories + menu items + ingredients) — all RLS-scoped direct
 * SELECTs (the RLS policy already limits rows to F&B staff / owner of `clubId`; no RPC needed).
 * One react-query entry → a single `refetch()` / `invalidateQueries(['fnb','menu',clubId])` refreshes
 * everything; the admin managers call that after each upsert. Reused by OrderEntryPanel (F5),
 * RecipeEditor + StockInForm (F3). `fnb_*` is untyped → `supabase as any`.
 */
export function useFnbMenu(clubId: string | undefined) {
  return useQuery({
    queryKey: ["fnb", "menu", clubId],
    enabled: !!clubId,
    queryFn: async (): Promise<FnbMenuData> => {
      const sb = supabase as any;
      const [cat, items, ings] = await Promise.all([
        sb.from("fnb_categories").select("*").eq("club_id", clubId).order("sort_order").order("name"),
        sb.from("fnb_menu_items").select("*").eq("club_id", clubId).order("sort_order"),
        sb.from("fnb_ingredients").select("*").eq("club_id", clubId).order("name"),
      ]);
      if (cat.error) throw cat.error;
      if (items.error) throw items.error;
      if (ings.error) throw ings.error;
      return {
        categories: (cat.data ?? []) as FnbCategory[],
        items: (items.data ?? []) as FnbMenuItem[],
        ingredients: (ings.data ?? []) as FnbIngredient[],
      };
    },
  });
}
