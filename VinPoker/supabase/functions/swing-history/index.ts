import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json();
    const { table_id, limit = 10 } = body as {
      table_id: string;
      limit?: number;
    };

    if (!table_id) {
      return json({ error: "table_id required" }, 400);
    }

    const safeLimit = Math.min(Math.max(1, limit), 50);

    const { data, error } = await admin
      .from("dealer_assignments")
      .select(`
        id,
        status,
        swing_due_at,
        swing_processed_at,
        created_at,
        duration_minutes,
        overtime_started_at,
        dealer_attendance!attendance_id(
          dealer_id,
          dealers(full_name, tier, telegram_username)
        )
      `)
      .eq("table_id", table_id)
      .in("status", ["completed", "on_break"])
      .not("swing_processed_at", "is", null)
      .order("swing_processed_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      console.error("[swing-history] Query error:", error.message);
      return json({ error: error.message }, 500);
    }

    const history = (data ?? []).map((row) => {
      const att = (row as any).dealer_attendance;
      const dealer = att?.dealers;
      const dealerName = dealer?.full_name ?? "Unknown";
      const swungAt = (row as any).swing_processed_at;
      const duration = (row as any).duration_minutes ?? 0;
      const wasOT = !!(row as any).overtime_started_at;

      const startMs = new Date((row as any).created_at).getTime();
      const endMs = swungAt ? new Date(swungAt).getTime() : Date.now();
      const actualMins = Math.round((endMs - startMs) / 60_000);

      return {
        id: row.id,
        dealerName,
        dealerTier: dealer?.tier ?? null,
        status: row.status,
        swungAt,
        createdAt: (row as any).created_at,
        durationMinutes: duration,
        actualMinutes: actualMins,
        wasOT,
        overtimeMinutes: wasOT
          ? Math.round(
              (endMs - new Date((row as any).overtime_started_at).getTime()) / 60_000
            )
          : 0,
      };
    });

    return json({
      table_id,
      count: history.length,
      history,
    });
  } catch (err: any) {
    console.error("[swing-history] Unhandled:", err.message);
    return json({ error: "Internal error" }, 500);
  }
});
