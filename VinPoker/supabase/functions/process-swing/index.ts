import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const defaultChatId = Deno.env.get("TELEGRAM_DEFAULT_CHAT_ID")!;

    const admin = createClient(url, service);
    const now = new Date();

    // Verify bearer token or service key for cron invocation
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Find due assignments — assigned, not yet swing-processed, past swing duration
    const { data: dueAssignments, error: de } = await admin
      .from("dealer_assignments")
      .select(`
        id, table_id, attendance_id, assigned_at, version,
        game_tables!inner(id, table_name, table_type, club_id),
        dealer_attendance!inner(
          id,
          dealer_id,
          dealers!inner(id, full_name, tier)
        )
      `)
      .eq("status", "assigned")
      .is("swing_processed_at", null);

    if (de) return json({ error: de.message }, 500);

    // For each due assignment, get its swing_config and check if time is up
    const results: any[] = [];

    for (const assignment of dueAssignments ?? []) {
      const table = assignment.game_tables as any;
      const dealerAttendance = assignment.dealer_attendance as any;
      const dealer = dealerAttendance.dealers as any;
      const assignedAt = new Date(assignment.assigned_at);

      // Get swing duration for this club/table-type
      const { data: config } = await admin
        .from("swing_config")
        .select("swing_duration_minutes, break_duration_minutes")
        .eq("club_id", table.club_id)
        .eq("table_type", table.table_type)
        .maybeSingle();

      const durationMinutes = config?.swing_duration_minutes ?? 45;
      const swingDueAt = new Date(assignedAt.getTime() + durationMinutes * 60 * 1000);

      if (now < swingDueAt) {
        results.push({ id: assignment.id, status: "not_yet_due", due_at: swingDueAt.toISOString() });
        continue;
      }

      // CAS update — only one process wins the lock
      const { data: locked, error: lockError } = await admin
        .from("dealer_assignments")
        .update({
          swing_processed_at: now.toISOString(),
        })
        .eq("id", assignment.id)
        .eq("version", assignment.version)
        .eq("status", "assigned")
        .is("swing_processed_at", null)
        .select("id, version");

      if (lockError || !locked?.length) {
        results.push({ id: assignment.id, status: "race_lost" });
        continue;
      }

      // Release current dealer
      await admin
        .from("dealer_assignments")
        .update({ released_at: now.toISOString(), status: "completed" })
        .eq("id", assignment.id);

      // Log audit
      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        action: "swing",
        entity_type: "dealer_assignment",
        entity_id: assignment.id,
        payload: { table_id: table.id, released_dealer: dealer.full_name, swing_duration: durationMinutes },
      });

      // Find next dealer via fair rotation (call assign-dealer inline logic)
      const nextDealer = await pickNextDealer(admin, table.id, table.table_type, table.club_id);

      let newAssignmentId: string | null = null;
      let nextDealerName: string | null = null;

      if (nextDealer) {
        const { data: na } = await admin
          .from("dealer_assignments")
          .insert({
            attendance_id: nextDealer.attendance_id,
            table_id: table.id,
            assigned_at: now.toISOString(),
            status: "assigned",
            idempotency_key: `swing-${assignment.id}-${now.getTime()}`,
          })
          .select("id")
          .single();

        newAssignmentId = na?.id ?? null;
        nextDealerName = nextDealer.dealer_name;

        await admin.from("audit_logs").insert({
          club_id: table.club_id,
          action: "assign",
          entity_type: "dealer_assignment",
          entity_id: newAssignmentId,
          payload: { table_id: table.id, attendance_id: nextDealer.attendance_id, mode: "swing_rotation" },
        });
      }

      // Telegram notification
      const msg = nextDealerName
        ? `⏰ Đổi ca: ${table.table_name} — ${dealer.full_name} ra, ${nextDealerName} vào.`
        : `⚠️ Bàn ${table.table_name}: ${dealer.full_name} đã xong ca — CHƯA CÓ DEALER THAY!`;

      if (botToken) {
        // Get club's telegram chat_id
        const { data: cs } = await admin
          .from("club_settings")
          .select("telegram_chat_id")
          .eq("club_id", table.club_id)
          .maybeSingle();

        const chatId = (cs as any)?.telegram_chat_id || defaultChatId;

        if (chatId) {
          const tgRes = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: String(chatId),
                text: msg,
                parse_mode: "HTML",
                disable_web_page_preview: true,
              }),
            },
          );

          if (!tgRes.ok) {
            const tgBody = await tgRes.text();
            console.error("Telegram send failed:", tgRes.status, tgBody);

            await admin.from("audit_logs").insert({
              club_id: table.club_id,
              action: "telegram_failed",
              entity_type: "dealer_assignment",
              entity_id: assignment.id,
              payload: { error: tgBody, message: msg, chat_id: chatId },
            });

            // In-app notification fallback
            if (table.club_id && dealerAttendance.dealer_id) {
              await admin.from("notifications").insert({
                user_id: dealerAttendance.dealer_id,
                type: "system_alert",
                title: "🔔 Thông báo đổi ca",
                body: msg,
                data: { table_id: table.id, club_id: table.club_id },
              });
            }
          }
        }
      }

      results.push({
        id: assignment.id,
        status: "swung",
        released_dealer: dealer.full_name,
        new_dealer: nextDealerName,
        new_assignment_id: newAssignmentId,
      });
    }

    return json({ processed: results.length, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function pickNextDealer(
  admin: ReturnType<typeof createClient>,
  tableId: string,
  tableType: string,
  clubId: string,
): Promise<{ attendance_id: string; dealer_name: string; tier: string } | null> {
  const today = new Date().toISOString().split("T")[0];

  const { data: checkedIn } = await admin
    .from("dealer_attendance")
    .select(`
      id,
      dealer_id,
      dealers!inner(id, full_name, tier)
    `)
    .eq("shift_date", today)
    .eq("status", "checked_in")
    .in("dealers.club_id", [clubId]);

  if (!checkedIn?.length) return null;

  // Exclude busy dealers
  const { data: busy } = await admin
    .from("dealer_assignments")
    .select("attendance_id")
    .in("status", ["assigned", "on_break"])
    .in("attendance_id", checkedIn.map((c: any) => c.id));

  const busySet = new Set((busy ?? []).map((b: any) => b.attendance_id));
  const available = checkedIn.filter((c: any) => !busySet.has(c.id));
  if (!available.length) return null;

  // Get worked times
  const { data: workTimes } = await admin.rpc("get_dealer_worked_times", { p_shift_date: today });

  // Pick dealer with lowest worked time (simplified fair rotation)
  const scored = available.map((c: any) => {
    const dealer = c.dealers;
    const workedMin = (workTimes ?? []).find((w: any) => w.dealer_id === dealer.id)?.total_minutes ?? 0;

    let score = 0;
    if (dealer.tier === "A") score += 5;
    else if (dealer.tier === "B") score += 3;
    else score += 1;
    score -= Math.floor(workedMin / 30);

    return { attendance_id: c.id, dealer_name: dealer.full_name, tier: dealer.tier, score, worked_minutes: workedMin };
  }).sort((a: any, b: any) => b.score - a.score);

  return scored[0] ?? null;
}
