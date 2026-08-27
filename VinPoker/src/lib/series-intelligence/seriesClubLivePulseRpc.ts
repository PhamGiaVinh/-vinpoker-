import { supabase } from "@/integrations/supabase/client";
import {
  getSeriesClubLivePulseV1WithClient,
  type SeriesClubLivePulseRpcError,
  type SeriesClubLivePulseRpcResult,
} from "./seriesClubLivePulseClient";

export type { SeriesClubLivePulseRpcError, SeriesClubLivePulseRpcResult } from "./seriesClubLivePulseClient";

export async function getSeriesClubLivePulseV1(clubId: string): Promise<SeriesClubLivePulseRpcResult> {
  return getSeriesClubLivePulseV1WithClient(supabase, clubId);
}
