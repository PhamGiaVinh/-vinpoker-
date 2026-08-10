import { opsClient } from "@/integrations/supabase/opsClient";
import {
  createOwnerDailyDigestSupabaseSource,
  type OwnerDailyDigestRpcClient,
} from "@/ops/digest/ownerDailyDigestSupabaseSource";

export const ownerDailyDigestSupabaseSource = createOwnerDailyDigestSupabaseSource(
  opsClient as unknown as OwnerDailyDigestRpcClient,
);
