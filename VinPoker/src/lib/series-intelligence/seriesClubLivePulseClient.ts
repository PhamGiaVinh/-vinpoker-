import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSeriesClubLivePulseV1, type SeriesClubLivePulseV1 } from "./seriesClubLivePulseV1";

const CLUB_PULSE_RPC = "get_series_club_live_pulse_v1" as const;
// PostgreSQL accepts legacy UUID values without RFC version/variant bits.
const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SeriesClubLivePulseRpcError = "invalid_club_id" | "backend_unavailable" | "forbidden" | "rpc_error" | "malformed_response";
export type SeriesClubLivePulseRpcResult =
  | { readonly ok: true; readonly value: SeriesClubLivePulseV1 }
  | { readonly ok: false; readonly error: SeriesClubLivePulseRpcError; readonly retryable: boolean };

export type SeriesClubLivePulseRpcClient = Pick<SupabaseClient, "rpc">;

function classifyError(error: { code?: string; message?: string; status?: number } | null): Exclude<SeriesClubLivePulseRpcResult, { ok: true }> {
  if (!error) return { ok: false, error: "malformed_response", retryable: false };
  if (error.code === "42501") return { ok: false, error: "forbidden", retryable: false };
  if (["42P01", "42883", "PGRST202", "PGRST205", "404"].includes(error.code ?? "") || /does not exist|could not find|schema cache/i.test(error.message ?? "")) {
    return { ok: false, error: "backend_unavailable", retryable: false };
  }
  const retryable = [408, 429, 502, 503, 504].includes(error.status ?? Number.NaN)
    || /network|fetch|timeout|timed out|aborted|temporarily unavailable|gateway/i.test(error.message ?? "");
  return { ok: false, error: "rpc_error", retryable };
}

/**
 * Client-injected reader for a Club Pulse response. It deliberately owns no
 * default Supabase client, so alternate app shells can preserve their own
 * auth/session boundary.
 */
export async function getSeriesClubLivePulseV1WithClient(
  client: SeriesClubLivePulseRpcClient,
  clubId: string,
): Promise<SeriesClubLivePulseRpcResult> {
  if (!POSTGRES_UUID.test(clubId)) return { ok: false, error: "invalid_club_id", retryable: false };
  try {
    const { data, error } = await client.rpc(CLUB_PULSE_RPC, { p_club_id: clubId } as never);
    if (error) return classifyError(error);
    try {
      return { ok: true, value: parseSeriesClubLivePulseV1(data) };
    } catch {
      return { ok: false, error: "malformed_response", retryable: false };
    }
  } catch (error) {
    return classifyError({ message: error instanceof Error ? error.message : String(error ?? "") });
  }
}
