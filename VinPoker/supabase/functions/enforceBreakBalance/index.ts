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
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const defaultChatId = Deno.env.get("TELEGRAM_DEFAULT_CHAT_ID");

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);

    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { club_id, dry_run } = body ?? {};

    const results: {
      club_id: string;
      available_forced: number;
      assigned_flagged: number;
      errors: string[];
      details: any[];
    }[] = [];

    // Get all clubs with active dealers, or just the specified one
    let clubQuery = admin.from("clubs").select("id, name");
    if (club_id) clubQuery = clubQuery.eq("id", club_id);
    const { data: clubs } = await clubQuery;
    if (!clubs?.length) return json({ status: "no_clubs", results: [] });

    const today = new Date().toISOString().split("T")[0];
    const now = new Date().toISOString();

    for (const club of clubs) {
      const clubResult = {
        club_id: club.id,
        available_forced: 0,
        assigned_flagged: 0,
        errors: [] as string[],
        details: [] as any[],
      };
      results.push(clubResult);

      try {
        // Get break policy for this club
        const { data: policy } = await admin
          .from("shift_break_policies")
          .select("*")
          .eq("club_id", club.id)
          .eq("shift_type", "default")
          .maybeSingle();

        const maxWorkThreshold = policy?.max_work_before_mandatory_break_minutes ?? 120;

        // Get all checked-in dealers with current assignments
        const { data: attendanceRows } = await admin
          .from("dealer_attendance")
          .select(`
            id, dealer_id, shift_id, current_state, worked_minutes_since_last_break, priority_break_flag,
            dealers!inner(id, full_name, club_id)
          `)
          .eq("shift_date", today)
          .eq("status", "checked_in")
          .eq("dealers.club_id", club.id);

        if (!attendanceRows?.length) continue;

        // Get active assignments for these attendance records
        const attIds = attendanceRows.map((r: any) => r.id);
        const { data: activeAssignments } = await admin
          .from("dealer_assignments")
          .select("id, attendance_id, table_id, status, released_at")
          .in("status", ["assigned", "on_break"])
          .in("attendance_id", attIds);

        const assignmentMap: Record<string, any> = {};
        for (const a of activeAssignments ?? []) {
          if (!assignmentMap[a.attendance_id]) assignmentMap[a.attendance_id] = a;
        }

        // Swing config for break duration
        const { data: swingConfig } = await admin
          .from("swing_config")
          .select("break_duration_minutes")
          .eq("club_id", club.id)
          .eq("table_type", "cash")
          .maybeSingle();

        const breakDuration = swingConfig?.break_duration_minutes ?? 20;

        for (const att of attendanceRows as any[]) {
          const worked = att.worked_minutes_since_last_break ?? 0;
          const currentState = att.current_state ?? "available";
          const assignment = assignmentMap[att.id];

          // Dealers on break are fine
          if (currentState === "on_break") continue;

          // Dealers who've exceeded mandatory threshold
          if (worked >= maxWorkThreshold) {
            if (currentState === "available" && !assignment) {
              // Auto-send available dealer to break
              clubResult.details.push({
                dealer_id: att.dealer_id,
                dealer_name: att.dealers?.full_name,
                action: "force_break",
                worked_minutes: worked,
                threshold: maxWorkThreshold,
              });

              if (!dry_run) {
                // Create a break-only assignment
                const { data: breakAssignment, error: baErr } = await admin
                  .from("dealer_assignments")
                  .insert({
                    attendance_id: att.id,
                    table_id: null,
                    assigned_at: now,
                    status: "on_break",
                    idempotency_key: `enforce-break-${att.id}-${today}`,
                  })
                  .select("id")
                  .single();

                if (baErr) {
                  clubResult.errors.push(`Failed to create break assignment for ${att.dealers?.full_name}: ${baErr.message}`);
                  continue;
                }

                // Create break record
                await admin.from("dealer_breaks").insert({
                  assignment_id: breakAssignment.id,
                  break_start: now,
                  expected_duration_minutes: breakDuration,
                  is_auto_triggered: true,
                });

                // Update attendance state
                await admin
                  .from("dealer_attendance")
                  .update({ current_state: "on_break", priority_break_flag: false })
                  .eq("id", att.id);

                // Audit log
                await admin.from("swing_audit_logs").insert({
                  club_id: club.id,
                  action: "mandatory_break_enforced",
                  old_dealer_id: att.dealer_id,
                  details: {
                    attendance_id: att.id,
                    worked_minutes: worked,
                    threshold: maxWorkThreshold,
                    type: "available",
                  },
                  triggered_by: "system",
                });

                clubResult.available_forced++;
              }
            } else if (currentState === "assigned" || assignment) {
              // Flag assigned dealer for priority break
              clubResult.details.push({
                dealer_id: att.dealer_id,
                dealer_name: att.dealers?.full_name,
                action: "flag_priority",
                worked_minutes: worked,
                threshold: maxWorkThreshold,
              });

              if (!dry_run && !att.priority_break_flag) {
                await admin
                  .from("dealer_attendance")
                  .update({ priority_break_flag: true })
                  .eq("id", att.id);

                await admin.from("swing_audit_logs").insert({
                  club_id: club.id,
                  action: "priority_break_flagged",
                  old_dealer_id: att.dealer_id,
                  details: {
                    attendance_id: att.id,
                    worked_minutes: worked,
                    threshold: maxWorkThreshold,
                    type: "assigned",
                  },
                  triggered_by: "system",
                });

                // Send Telegram alert
                if (botToken && defaultChatId) {
                  const dealerName = att.dealers?.full_name ?? "Unknown";
                  const msg = `⚠️ *Cảnh báo break*: ${dealerName} đã làm ${worked} phút tại ${club.name}. Cần cho nghỉ ngay!`;
                  try {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: defaultChatId,
                        text: msg,
                        parse_mode: "Markdown",
                      }),
                    });
                  } catch { /* Telegram failures are non-critical */ }
                }

                clubResult.assigned_flagged++;
              }
            }
          }
        }
      } catch (e: any) {
        clubResult.errors.push(`Club ${club.id}: ${e.message}`);
      }
    }

    return json({
      status: dry_run ? "dry_run_complete" : "complete",
      results,
      summary: results.reduce((s, r) => ({
        forced: s.forced + r.available_forced,
        flagged: s.flagged + r.assigned_flagged,
        errors: s.errors + r.errors.length,
      }), { forced: 0, flagged: 0, errors: 0 }),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
