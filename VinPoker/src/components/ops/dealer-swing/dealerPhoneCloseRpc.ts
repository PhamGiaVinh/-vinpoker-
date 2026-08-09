import { supabase } from "@/integrations/supabase/client";
import {
  DEALER_PHONE_CLOSE_RPC,
  parseDealerPhoneCloseResponse,
  type DealerPhoneCloseArgs,
  type DealerPhoneCloseResponse,
} from "./dealerPhoneCloseContract";

export {
  DEALER_PHONE_CLOSE_RPC,
  parseDealerPhoneCloseResponse,
  type DealerPhoneCloseArgs,
  type DealerPhoneCloseOutcome,
  type DealerPhoneCloseResponse,
  type DealerPhoneCloseSnapshot,
} from "./dealerPhoneCloseContract";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type DealerPhoneCloseRpc = (
  name: typeof DEALER_PHONE_CLOSE_RPC,
  args: DealerPhoneCloseArgs,
) => PromiseLike<RpcResult>;

// TODO(db-governance): remove this narrow generated-type bridge after the global
// Supabase type sync can safely include the canonical phone RPC.
const rpcDealerPhoneClose = supabase.rpc.bind(supabase) as unknown as DealerPhoneCloseRpc;

export async function closeDealerTablesPhone(args: DealerPhoneCloseArgs): Promise<DealerPhoneCloseResponse> {
  const result = await rpcDealerPhoneClose(DEALER_PHONE_CLOSE_RPC, args);
  if (result.error) throw result.error;

  const response = parseDealerPhoneCloseResponse(result.data);
  if (!response) throw new Error("Phản hồi đóng bàn không đúng hợp đồng an toàn.");
  return response;
}
