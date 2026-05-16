import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 30-day cutoff
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Find tournaments that are finished AND started more than 30 days ago
    const { data: oldTournaments, error: tErr } = await supabase
      .from("tournaments")
      .select("id")
      .eq("live_status", "finished")
      .lt("start_time", cutoff)
      .limit(1000);

    if (tErr) throw tErr;

    const tournamentIds = (oldTournaments ?? []).map((t: any) => t.id);
    let archivedCount = 0;

    if (tournamentIds.length > 0) {
      const { data: updated, error: uErr } = await supabase
        .from("booking_chats")
        .update({ archived_at: new Date().toISOString() })
        .in("tournament_id", tournamentIds)
        .is("archived_at", null)
        .select("id");

      if (uErr) throw uErr;
      archivedCount = updated?.length ?? 0;
    }

    console.log(`[archive-old-chats] Archived ${archivedCount} chats from ${tournamentIds.length} old tournaments.`);

    return new Response(
      JSON.stringify({ success: true, archived: archivedCount, tournaments_checked: tournamentIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err: any) {
    console.error("[archive-old-chats] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
