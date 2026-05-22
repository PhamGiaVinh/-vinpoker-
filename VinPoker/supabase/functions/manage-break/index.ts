import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const defaultChatId = Deno.env.get("TELEGRAM_DEFAULT_CHAT_ID")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);

    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const { attendance_id, action, requested_by } = body ?? {};
    if (!attendance_id || !["start", "end"].includes(action)) {
      return json({ error: "attendance_id and action (start|end) required" }, 400);
    }

    if (action === "start") {
      // Find current assignment for this dealer attendance
      const { data: assignment, error: ae } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, status, version,
          game_tables!inner(id, table_name, table_type, club_id)
        `)
        .eq("attendance_id", attendance_id)
        .eq("status", "assigned")
        .maybeSingle();

      if (ae || !assignment) return json({ error: "No active assignment found for this dealer" }, 404);

      // Check permissions
      const table = assignment.game_tables as any;
      const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: table.club_id });
      if (!isControl) return json({ error: "Forbidden" }, 403);

      // CAS update: set status to on_break
      const { data: updated, error: ue2 } = await admin
        .from("dealer_assignments")
        .update({ status: "on_break" })
        .eq("id", assignment.id)
        .eq("version", assignment.version)
        .eq("status", "assigned")
        .select("id, version");

      if (ue2 || !updated?.length) return json({ error: "Race condition — assignment was modified. Retry." }, 409);

      // Get swing config for break duration
      const { data: config } = await admin
        .from("swing_config")
        .select("break_duration_minutes")
        .eq("club_id", table.club_id)
        .eq("table_type", table.table_type)
        .maybeSingle();

      const breakDuration = config?.break_duration_minutes ?? 20;

      // Create break record
      const { data: breakRecord, error: be } = await admin
        .from("dealer_breaks")
        .insert({
          assignment_id: assignment.id,
          break_start: new Date().toISOString(),
          expected_duration_minutes: breakDuration,
        })
        .select("id")
        .single();

      if (be) return json({ error: be.message }, 500);

      // Audit log
      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: requested_by ?? uid,
        action: "break_start",
        entity_type: "dealer_assignment",
        entity_id: assignment.id,
        payload: { table_id: table.id, break_id: breakRecord.id, break_duration: breakDuration },
      });

      return json({
        status: "break_started",
        assignment_id: assignment.id,
        break_id: breakRecord.id,
        expected_end_at: new Date(Date.now() + breakDuration * 60 * 1000).toISOString(),
      });
    }

    if (action === "end") {
      // Find current on_break assignment
      const { data: assignment, error: ae } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, status, version,
          game_tables!inner(id, table_name, table_type, club_id)
        `)
        .eq("attendance_id", attendance_id)
        .eq("status", "on_break")
        .maybeSingle();

      if (ae || !assignment) return json({ error: "No active break found for this dealer" }, 404);

      const table = assignment.game_tables as any;
      const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: table.club_id });
      if (!isControl) return json({ error: "Forbidden" }, 403);

      // CAS update: set status back to assigned
      const { data: updated, error: ue2 } = await admin
        .from("dealer_assignments")
        .update({ status: "assigned" })
        .eq("id", assignment.id)
        .eq("version", assignment.version)
        .eq("status", "on_break")
        .select("id, version");

      if (ue2 || !updated?.length) return json({ error: "Race condition — break was modified. Retry." }, 409);

      // Close break record
      const { data: breakRec } = await admin
        .from("dealer_breaks")
        .select("id")
        .eq("assignment_id", assignment.id)
        .is("break_end", null)
        .order("break_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (breakRec) {
        await admin.from("dealer_breaks").update({ break_end: new Date().toISOString() }).eq("id", breakRec.id);
      }

      // Get swing config for break_return_policy
      const { data: config } = await admin
        .from("swing_config")
        .select("break_return_policy")
        .eq("club_id", table.club_id)
        .eq("table_type", table.table_type)
        .maybeSingle();

      const returnPolicy = config?.break_return_policy ?? "fifo";

      let newTableId = table.id;

      // If return policy is not same_table, find a new table
      if (returnPolicy !== "same_table") {
        const { data: needyTables } = await admin
          .from("game_tables")
          .select(`
            id, table_name,
            dealer_assignments!left(id, status)
          `)
          .eq("club_id", table.club_id)
          .eq("status", "active")
          .order("created_at", { ascending: true });

        // Find tables with no current assignment (empty)
        const emptyTable = (needyTables ?? []).find((t: any) =>
          !(t.dealer_assignments ?? []).some((da: any) => da.status === "assigned" || da.status === "on_break")
        );

        if (emptyTable) {
          newTableId = emptyTable.id;

          // Release from old table, assign to new
          await admin
            .from("dealer_assignments")
            .update({ released_at: new Date().toISOString(), status: "completed" })
            .eq("id", assignment.id);

          const { data: newAssignment } = await admin
            .from("dealer_assignments")
            .insert({
              attendance_id,
              table_id: newTableId,
              assigned_at: new Date().toISOString(),
              status: "assigned",
              idempotency_key: `break-return-${assignment.id}-${Date.now()}`,
            })
            .select("id")
            .single();

          await admin.from("audit_logs").insert({
            club_id: table.club_id,
            actor_id: requested_by ?? uid,
            action: "break_return_reroute",
            entity_type: "dealer_assignment",
            entity_id: newAssignment?.id ?? assignment.id,
            payload: { from_table: table.id, to_table: newTableId, policy: returnPolicy },
          });
        }
      }

      // Audit log
      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: requested_by ?? uid,
        action: "break_end",
        entity_type: "dealer_assignment",
        entity_id: assignment.id,
        payload: { table_id: newTableId, return_policy: returnPolicy },
      });

      return json({
        status: "break_ended",
        assignment_id: assignment.id,
        returning_to_table: newTableId,
      });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
