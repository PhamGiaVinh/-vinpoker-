// Shared helper: look up the platform fixed fee for a given buy-in amount (VND).
// Falls back to the lowest tier (49.000 ₫) if no match.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function getFixedFeeForBuyIn(
  admin: ReturnType<typeof createClient>,
  buyInVnd: number,
): Promise<{ fixed_fee: number; percent_fee: number }> {
  try {
    const { data } = await admin
      .from("platform_fee_config")
      .select("fixed_fee, percent_fee")
      .lte("min_buy_in", buyInVnd)
      .gte("max_buy_in", buyInVnd)
      .eq("is_active", true)
      .order("min_buy_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { fixed_fee: Number(data.fixed_fee), percent_fee: Number(data.percent_fee) };
  } catch (_) { /* ignore */ }
  return { fixed_fee: 49000, percent_fee: 1.0 };
}
