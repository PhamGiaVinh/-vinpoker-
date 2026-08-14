import { supabase } from "@/integrations/supabase/client";
import {
  createOwnerDailyDigestV2Source,
  type OwnerDailyDigestV2RpcClient,
} from "@/ops/digest/ownerDailyDigestV2Source";

export const ownerDailyDigestV2RuntimeSource = createOwnerDailyDigestV2Source(
  supabase as unknown as OwnerDailyDigestV2RpcClient,
);
