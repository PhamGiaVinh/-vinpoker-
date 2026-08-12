import { supabase } from "@/integrations/supabase/client";
import {
  createOwnerDailyDigestSupabaseSource,
  type OwnerDailyDigestRpcClient,
} from "@/ops/digest/ownerDailyDigestSupabaseSource";

export const ownerDailyDigestPrimarySupabaseSource = createOwnerDailyDigestSupabaseSource(
  supabase as unknown as OwnerDailyDigestRpcClient,
);
