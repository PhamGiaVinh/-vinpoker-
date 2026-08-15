import { supabase } from "@/integrations/supabase/client";
import {
  fetchBuyinReceiptWithClient,
  type BuyinReceiptLookup,
  type BuyinReceiptSnapshot,
} from "./buyinReceiptCore";

export {
  toSeatReceiptData,
  type BuyinReceiptLookup,
  type BuyinReceiptSnapshot,
} from "./buyinReceiptCore";

/**
 * Fetches one server-authorized receipt snapshot. A failed hydration intentionally
 * returns null so historic staff receipts can continue to render their local data.
 */
export async function fetchBuyinReceipt(lookup: BuyinReceiptLookup): Promise<BuyinReceiptSnapshot | null> {
  return fetchBuyinReceiptWithClient(supabase, lookup);
}
