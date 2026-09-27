import type { OpsClient } from "@/ops/opsMutations";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
type MultiDayRpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };

/** Delegated Ops RPC seam. The shell supplies its authenticated client. */
export async function callMultiDayFloorRpc<T>(
  client: OpsClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (client as unknown as MultiDayRpcClient).rpc(name, args);
  if (error) throw error;
  return data as T;
}
