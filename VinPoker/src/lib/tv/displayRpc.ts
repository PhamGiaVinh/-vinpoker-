import { supabase } from "@/integrations/supabase/client";

// The tv_* RPCs went live with migration 20260818000001, which postdates the
// generated src/integrations/supabase/types.ts — call them through one local
// cast until the types file is regenerated (planned alongside PR C3).
type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const rpc = supabase.rpc.bind(supabase) as UntypedRpc;

export interface TvPairBeginResult {
  error?: string;
  display_id?: string;
  pair_code?: string;
  display_token?: string;
  expires_at?: string;
}

export async function rpcTvPairBegin(): Promise<{ data: TvPairBeginResult | null; error: string | null }> {
  const { data, error } = await rpc("tv_pair_begin");
  return { data: (data as TvPairBeginResult) ?? null, error: error?.message ?? null };
}

export async function rpcGetTvDisplayState(
  displayToken: string,
): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await rpc("get_tv_display_state", { p_display_token: displayToken });
  return { data, error: error?.message ?? null };
}
