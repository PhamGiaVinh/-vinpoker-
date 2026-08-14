import { opsClient } from "@/integrations/supabase/opsClient";
import {
  createOwnerDailyDigestV2Source,
  type OwnerDailyDigestV2RpcClient,
} from "@/ops/digest/ownerDailyDigestV2Source";

export const ownerDailyDigestV2OpsRuntimeSource = createOwnerDailyDigestV2Source(
  opsClient as unknown as OwnerDailyDigestV2RpcClient,
);
