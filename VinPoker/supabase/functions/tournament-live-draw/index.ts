import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json();
  const { tournament_id, action } = body;

  if (!tournament_id || !action) return new Response(JSON.stringify({ error: "Missing tournament_id or action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let result: any;

  try {
    switch (action) {
      case "get_seats": {
        result = await supabase.rpc("get_seats_for_draw", { p_tournament_id: tournament_id });
        break;
      }
      case "update_seats": {
        const { seats } = body;
        const { data: upsertData, error: upsertError } = await supabase.from("tournament_seats").upsert(
          seats.map((seat: any) => ({
            tournament_id,
            player_id: seat.player_id,
            entry_number: seat.entry_number || 1,
            table_id: seat.table_id,
            seat_number: seat.seat_number,
            chip_count: seat.chip_count || 0,
            is_active: seat.is_active !== false,
            player_name: seat.player_name || "",
          })),
          { onConflict: "tournament_id,player_id,entry_number" }
        );
        if (upsertError) throw upsertError;
        result = { data: { updated: seats.length } };
        break;
      }
      case "add_table": {
        const { table_name } = body;
        if (!table_name) throw new Error("Missing table_name");

        const { data: existing } = await supabase
          .from("tournament_tables")
          .select("id")
          .eq("tournament_id", tournament_id)
          .eq("table_name", table_name)
          .maybeSingle();
        if (existing) throw new Error("Table name already exists in this tournament");

        const { data, error: addErr } = await supabase
          .from("tournament_tables")
          .insert({ tournament_id, table_name })
          .select()
          .single();
        if (addErr) throw addErr;
        result = { data };
        break;
      }
      case "add_player": {
        const { player_id, player_name, table_id: tbl, seat_number, chip_count } = body;
        if (!tbl || !seat_number) throw new Error("Missing required fields: table_id, seat_number");
        if ((chip_count ?? 0) < 0) throw new Error("chip_count must be >= 0");

        const { data: tblCheck } = await supabase
          .from("tournament_tables")
          .select("id")
          .eq("id", tbl)
          .eq("tournament_id", tournament_id)
          .maybeSingle();
        if (!tblCheck) throw new Error("Table does not belong to this tournament");

        const { data: seatOccupied } = await supabase
          .from("tournament_seats")
          .select("id")
          .eq("table_id", tbl)
          .eq("seat_number", seat_number)
          .eq("is_active", true)
          .maybeSingle();
        if (seatOccupied) throw new Error("Seat already occupied");

        const pId = player_id || crypto.randomUUID();
        const pName = player_name || "";

        const { data: nextEntry } = await supabase
          .from("tournament_seats")
          .select("entry_number")
          .eq("tournament_id", tournament_id)
          .eq("player_id", pId)
          .order("entry_number", { ascending: false })
          .limit(1);
        const entryNum = body.entry_number ?? ((nextEntry?.[0]?.entry_number ?? 0) + 1);

        const { data, error: seatErr } = await supabase
          .from("tournament_seats")
          .insert({
            tournament_id,
            player_id: pId,
            table_id: tbl,
            seat_number,
            entry_number: entryNum,
            chip_count: chip_count ?? 0,
            is_active: true,
            player_name: pName,
          })
          .select()
          .single();
        if (seatErr) throw seatErr;
        result = { data };
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (result.error) throw result.error;
    return new Response(JSON.stringify({ status: "success", data: result.data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});