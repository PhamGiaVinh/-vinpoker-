import { supabase } from "@/integrations/supabase/client";
import {
  createOwnerDailyDigestClubScopeSource,
  type OwnerDailyDigestClubScopeRpcClient,
} from "@/ops/digest/ownerDailyDigestClubScopeSource";

export const ownerDailyDigestClubScopeRuntimeSource = createOwnerDailyDigestClubScopeSource(
  supabase as unknown as OwnerDailyDigestClubScopeRpcClient,
);
