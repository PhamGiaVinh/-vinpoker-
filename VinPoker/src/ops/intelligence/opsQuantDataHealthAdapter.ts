import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseOpsRegistrationPaceQ0, parseOpsSepayReadStateQ0, type OpsRegistrationPaceQ0, type OpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";

type OpsClient = SupabaseClient<Database>;
type UntypedRpcClient = { rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }> };

export interface OpsQuantReadReceiptQ0<T> {
  readonly value: T | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
}

export async function loadOpsRegistrationPaceQ0(client: OpsClient, clubId: string): Promise<OpsQuantReadReceiptQ0<OpsRegistrationPaceQ0>> {
  return loadRpc(client, "get_ops_registration_pace_q0", clubId, parseOpsRegistrationPaceQ0, "REGISTRATION_PACE_READ_FAILED");
}

export async function loadOpsSepayReadStateQ0(client: OpsClient, clubId: string): Promise<OpsQuantReadReceiptQ0<OpsSepayReadStateQ0>> {
  return loadRpc(client, "get_ops_sepay_read_state_q0", clubId, parseOpsSepayReadStateQ0, "SEPAY_READ_FAILED");
}

async function loadRpc<T>(client: OpsClient, rpcName: string, clubId: string, parse: (value: unknown) => T, fallbackReason: string): Promise<OpsQuantReadReceiptQ0<T>> {
  const result = await (client as unknown as UntypedRpcClient).rpc(rpcName, { p_club_id: clubId });
  const observedAt = new Date().toISOString();
  if (result.error) return Object.freeze({ value: null, observedAt, reasonCode: result.error.message ?? fallbackReason });
  try {
    const value = parse(result.data);
    if ((value as { clubId?: string }).clubId !== clubId) throw new Error("cross-club payload");
    return Object.freeze({ value, observedAt, reasonCode: null });
  } catch {
    return Object.freeze({ value: null, observedAt, reasonCode: `${fallbackReason}_MALFORMED` });
  }
}
