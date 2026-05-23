import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const defaultChatId = Deno.env.get("TELEGRAM_DEFAULT_CHAT_ID")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const now = new Date();

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    let clubId: string | null = null;
    let shiftId: string | null = null;
    let manualTrigger = false;
    let dryRun = false;
    try {
      const body = await req.json();
      clubId = body.club_id ?? null;
      shiftId = body.shift_id ?? null;
      manualTrigger = body.manual_trigger ?? false;
      dryRun = body.dry_run ?? false;
    } catch {
      /* no body — full swing (cron) */
    }

    const startTime = Date.now();
    const results: any[] = [];
    const errors: any[] = [];

    // Build query for due assignments
    let q = admin
      .from("dealer_assignments")
      .select(`
        id, table_id, attendance_id, assigned_at, version,
        game_tables!inner(id, table_name, table_type, club_id),
        dealer_attendance!inner(id, dealer_id, shift_id, status, check_in_time, current_state, worked_minutes_since_last_break,
          dealers!inner(id, full_name, tier))
      `)
      .eq("status", "assigned")
      .is("swing_processed_at", null);

    if (clubId) q = q.eq("game_tables.club_id", clubId);
    if (shiftId) q = q.eq("dealer_attendance.shift_id", shiftId);

    const { data: dueAssignments, error: de } = await q;
    if (de) return json({ error: de.message }, 500);

    let successCount = 0;
    let failCount = 0;
    let noDealerCount = 0;

    for (const assignment of dueAssignments ?? []) {
      try {
        const table = assignment.game_tables as any;
        const da = assignment.dealer_attendance as any;
        const dealer = da.dealers as any;
        const assignedAt = new Date(assignment.assigned_at);

        // Get swing config
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

        if (dryRun) {
          results.push({ id: assignment.id, status: "would_swing", table_name: table.table_name, due_at: swingDueAt.toISOString() });
          continue;
        }

        // CAS lock — only one wins
        const { data: locked, error: lockError } = await admin
          .from("dealer_assignments")
          .update({ swing_processed_at: now.toISOString() })
          .eq("id", assignment.id)
          .eq("version", assignment.version)
          .eq("status", "assigned")
          .is("swing_processed_at", null)
          .select("id");

        if (lockError || !locked?.length) {
          results.push({ id: assignment.id, status: "race_lost" });
          continue;
        }

        // Release old dealer
        await admin
          .from("dealer_assignments")
          .update({ released_at: now.toISOString(), status: "completed" })
          .eq("id", assignment.id);

        // Set old dealer state to available
        await admin
          .from("dealer_attendance")
          .update({ current_state: "available" })
          .eq("id", da.id);

        // Evaluate break need
        const breakResult = await evaluateBreakNeed(admin, da.dealer_id, da.shift_id, table.club_id, da.id, config?.break_duration_minutes ?? 20);
        let dealerWentOnBreak = false;

        if (breakResult.should_break) {
          dealerWentOnBreak = true;
          await admin
            .from("dealer_attendance")
            .update({ current_state: "on_break", priority_break_flag: false })
            .eq("id", da.id);

          await admin.from("swing_audit_logs").insert({
            club_id: table.club_id,
            shift_id: da.shift_id,
            assignment_id: assignment.id,
            old_dealer_id: da.dealer_id,
            action: "break_auto",
            details: { reason: breakResult.reason, urgency: breakResult.urgency, table_name: table.table_name },
            triggered_by: manualTrigger ? "manual" : "cron",
          }).catch(() => {});
        }

        // Get shift tour_tier
        const { data: shift } = await admin
          .from("dealer_shifts")
          .select("tour_tier")
          .eq("id", da.shift_id)
          .maybeSingle();

        // Pick next dealer (corrected scoring)
        const nextDealer = await pickNextDealer(admin, table.club_id, da.shift_id, table.table_type, shift?.tour_tier ?? "MEDIUM", durationMinutes);

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

          await admin
            .from("dealer_attendance")
            .update({ current_state: "assigned" })
            .eq("id", nextDealer.attendance_id);

          successCount++;
        } else {
          noDealerCount++;
          successCount++;
        }

        // Audit log
        await admin.from("swing_audit_logs").insert({
          club_id: table.club_id,
          shift_id: da.shift_id,
          assignment_id: assignment.id,
          old_dealer_id: da.dealer_id,
          new_dealer_id: nextDealer?.dealer_id ?? null,
          table_id: table.id,
          action: nextDealer ? "swing_success" : "swing_no_dealer",
          details: {
            table_name: table.table_name,
            old_dealer_name: dealer.full_name,
            new_dealer_name: nextDealerName,
            old_went_on_break: dealerWentOnBreak,
            break_reason: breakResult.reason,
          },
          triggered_by: manualTrigger ? "manual" : "cron",
        }).catch(() => {});

        // Telegram (async, non-blocking)
        sendTelegramNotification(admin, botToken, defaultChatId, table, dealer.full_name, nextDealerName, assignment.id).catch(() => {});

        results.push({
          id: assignment.id,
          status: nextDealer ? "swung" : "swung_no_dealer",
          table_name: table.table_name,
          released_dealer: dealer.full_name,
          new_dealer: nextDealerName,
          new_assignment_id: newAssignmentId,
          old_dealer_break: dealerWentOnBreak,
          break_reason: breakResult.reason,
        });
      } catch (err) {
        failCount++;
        const errMsg = (err as Error).message;
        errors.push({ assignment_id: assignment.id, error: errMsg });

        await admin.from("swing_audit_logs").insert({
          club_id: (assignment.game_tables as any)?.club_id ?? "00000000-0000-0000-0000-000000000000",
          assignment_id: assignment.id,
          action: "swing_error",
          error_message: errMsg,
          triggered_by: manualTrigger ? "manual" : "cron",
        }).catch(() => {});
      }
    }

    // Upsert daily swing metrics
    if (!dryRun && (successCount + failCount) > 0 && dueAssignments?.length) {
      const firstClubId = (dueAssignments[0].game_tables as any)?.club_id;
      if (firstClubId) {
        const today = now.toISOString().split("T")[0];
        const total = successCount + failCount;
        const { data: existing } = await admin
          .from("swing_metrics")
          .select("*")
          .eq("club_id", firstClubId)
          .eq("date", today)
          .maybeSingle();

        if (existing) {
          await admin.from("swing_metrics").update({
            total_swings: existing.total_swings + total,
            successful_swings: existing.successful_swings + successCount,
            failed_swings: existing.failed_swings + failCount,
            no_dealer_swings: existing.no_dealer_swings + noDealerCount,
            avg_processing_time_ms: Math.round((Date.now() - startTime) / total),
          }).eq("id", existing.id);
        } else {
          await admin.from("swing_metrics").insert({
            club_id: firstClubId,
            date: today,
            total_swings: total,
            successful_swings: successCount,
            failed_swings: failCount,
            no_dealer_swings: noDealerCount,
            avg_processing_time_ms: Math.round((Date.now() - startTime) / total),
          });
        }
      }
    }

    return json({
      success: failCount === 0,
      processed_count: successCount,
      failed_count: failCount,
      no_dealer_count: noDealerCount,
      execution_time_ms: Date.now() - startTime,
      swings: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/* ------------------------------------------------------------------ */
/*  Break Eligibility Evaluation                                       */
/* ------------------------------------------------------------------ */
async function evaluateBreakNeed(
  admin: ReturnType<typeof createClient>,
  dealerId: string,
  shiftId: string | null,
  clubId: string,
  attendanceId: string,
  _defaultBreakDuration: number,
): Promise<{ should_break: boolean; reason: string; urgency: string }> {
  const { data: policy } = await admin
    .from("shift_break_policies")
    .select("*")
    .eq("club_id", clubId)
    .eq("shift_type", "default")
    .maybeSingle();

  const maxWork = policy?.max_work_before_mandatory_break_minutes ?? 120;
  const minWork = policy?.min_work_before_break_minutes ?? 90;

  const { data: attendance } = await admin
    .from("dealer_attendance")
    .select("worked_minutes_since_last_break")
    .eq("id", attendanceId)
    .maybeSingle();

  if (!attendance) return { should_break: false, reason: "no_attendance", urgency: "none" };

  const workedMinutes = attendance.worked_minutes_since_last_break ?? 0;

  // Mandatory
  if (workedMinutes >= maxWork) {
    return { should_break: true, reason: "mandatory", urgency: "immediate" };
  }

  // Eligible + balance deficit
  if (workedMinutes >= minWork) {
    const { data: metrics } = await admin
      .from("dealer_shift_metrics")
      .select("total_break_minutes")
      .eq("attendance_id", attendanceId)
      .maybeSingle();

    const dealerBreak = metrics?.total_break_minutes ?? 0;

    const { data: allMetrics } = await admin
      .from("dealer_shift_metrics")
      .select("total_break_minutes")
      .eq("shift_id", shiftId);

    const breakTimes: number[] = (allMetrics ?? []).map((m: any) => m.total_break_minutes ?? 0);
    const avgBreak = breakTimes.length > 0
      ? breakTimes.reduce((a: number, b: number) => a + b, 0) / breakTimes.length
      : 0;
    const deficit = avgBreak - dealerBreak;

    // Coverage check
    const { count: available } = await admin
      .from("dealer_attendance")
      .select("id", { count: "exact", head: true })
      .eq("current_state", "available")
      .in("club_id", await getClubIdsForDealers(admin, clubId));

    const { count: activeTables } = await admin
      .from("dealer_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "assigned")
      .in("table_id", await getTableIdsForClub(admin, clubId));

    const availCount = available ?? 0;
    const activeCount = activeTables ?? 0;
    const canCover = availCount - 1 >= Math.ceil(activeCount * 0.2);

    if (deficit >= 10 && canCover) {
      return { should_break: true, reason: "balance", urgency: "soon" };
    }
  }

  return { should_break: false, reason: "none", urgency: "none" };
}

/* ------------------------------------------------------------------ */
/*  Fair Dealer Scoring (corrected algorithm)                          */
/* ------------------------------------------------------------------ */
async function pickNextDealer(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  shiftId: string | null,
  _tableType: string,
  tourTier: string,
  _swingDurationMinutes: number,
): Promise<{ attendance_id: string; dealer_id: string; dealer_name: string; tier: string } | null> {
  const today = new Date().toISOString().split("T")[0];

  // Available dealers
  let q = admin
    .from("dealer_attendance")
    .select(`
      id, dealer_id, shift_id, worked_minutes_since_last_break, current_state, priority_break_flag,
      dealers!inner(id, full_name, tier, club_id)
    `)
    .eq("shift_date", today)
    .eq("status", "checked_in")
    .eq("current_state", "available")
    .eq("dealers.club_id", clubId);

  if (shiftId) q = q.eq("shift_id", shiftId);

  const { data: available } = await q;
  if (!available?.length) return null;

  const dealerIds = available.map((a: any) => a.dealer_id);
  const { data: metrics } = await admin
    .from("dealer_shift_metrics")
    .select("*")
    .in("dealer_id", dealerIds)
    .eq("shift_id", shiftId ?? "");

  const metricsMap = new Map((metrics ?? []).map((m: any) => [m.dealer_id, m]));

  // Averages for balance calculations
  const allWorked: number[] = (metrics ?? []).map((m: any) => m.total_worked_minutes ?? 0);
  const avgWorkedMinutes = allWorked.length > 0
    ? allWorked.reduce((a: number, b: number) => a + b, 0) / allWorked.length
    : 0;

  const allBreak: number[] = (metrics ?? []).map((m: any) => m.total_break_minutes ?? 0);
  const avgBreakMinutes = allBreak.length > 0
    ? allBreak.reduce((a: number, b: number) => a + b, 0) / allBreak.length
    : 0;

  const allHv: number[] = (metrics ?? []).map((m: any) => m.high_value_assignments ?? 0);
  const avgHv = allHv.length > 0
    ? allHv.reduce((a: number, b: number) => a + b, 0) / allHv.length
    : 0;

  const scored = available.map((a: any) => {
    const m = metricsMap.get(a.dealer_id);
    const dealer = a.dealers;
    let score = 0;

    const totalAssignments = m?.total_assignments ?? 0;
    const minutesSinceRest = m?.minutes_since_rest ?? 0;
    const workedSinceBreak = a.worked_minutes_since_last_break ?? 0;
    const dealerWorkedMinutes = m?.total_worked_minutes ?? 0;
    const dealerBreakMinutes = m?.total_break_minutes ?? 0;
    const dealerHv = m?.high_value_assignments ?? 0;

    // P1: First-time bonus (dominant)
    if (totalAssignments === 0) score += 1000;

    // P2: Freshness — well-rested dealers get higher score
    score += Math.min(200, minutesSinceRest * 1.5);

    // P2.5: Fatigue penalty — tired dealers get LOWER score (CORRECTED)
    const minutesUntilMandatory = 120 - workedSinceBreak;
    if (minutesUntilMandatory < 30) {
      score -= (30 - minutesUntilMandatory) * 2;
    }

    // P3: Workload balance — less-worked dealers get bonus
    score += (avgWorkedMinutes - dealerWorkedMinutes) * 0.3;

    // P4: Break balance — MORE break = HIGHER score (CORRECTED)
    score += (dealerBreakMinutes - avgBreakMinutes) * 0.4;

    // P5: Tier matching
    const tierNum = dealer.tier === "A" ? 3 : dealer.tier === "B" ? 2 : 1;
    const tableTierNum = tourTier === "HIGH" ? 3 : tourTier === "MEDIUM" ? 2 : 1;
    if (tierNum >= tableTierNum + 1) score += 30;
    else if (tierNum === tableTierNum) score += 20;
    else if (tierNum === tableTierNum - 1) score += 5;

    // P6: Skill (simplified)
    score += 10;

    // P7: High-value rotation
    if (tourTier === "HIGH") {
      score += (avgHv - dealerHv) * 3;
    }

    return {
      attendance_id: a.id,
      dealer_id: a.dealer_id,
      dealer_name: dealer.full_name,
      tier: dealer.tier,
      score,
    };
  }).sort((a: any, b: any) => b.score - a.score);

  return scored[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Telegram Notification (async with retry + exponential backoff)     */
/* ------------------------------------------------------------------ */
async function sendTelegramNotification(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  defaultChatId: string,
  table: any,
  oldDealerName: string,
  newDealerName: string | null,
  assignmentId: string,
) {
  if (!botToken) return;

  const msg = newDealerName
    ? `⏰ Đổi ca: ${table.table_name} — ${oldDealerName} ra, ${newDealerName} vào.`
    : `⚠️ Bàn ${table.table_name}: ${oldDealerName} đã xong ca — CHƯA CÓ DEALER THAY!`;

  try {
    const { data: cs } = await admin
      .from("club_settings")
      .select("telegram_chat_id")
      .eq("club_id", table.club_id)
      .maybeSingle();

    const chatId = (cs as any)?.telegram_chat_id || defaultChatId;
    if (!chatId) return;

    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: String(chatId), text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
          },
        );

        if (tgRes.ok) return;

        console.error("Telegram retry", i + 1, tgRes.status, await tgRes.text());
        if (i === MAX_RETRIES - 1) {
          await admin.from("swing_audit_logs").insert({
            club_id: table.club_id,
            assignment_id: assignmentId,
            action: "telegram_failed",
            details: { message: msg, chat_id: chatId },
            error_message: `HTTP ${tgRes.status}`,
            triggered_by: "system",
          }).catch(() => {});
        }
      } catch {
        if (i === MAX_RETRIES - 1) throw;
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  } catch (err) {
    console.error("Telegram failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
async function getClubIdsForDealers(admin: ReturnType<typeof createClient>, clubId: string): Promise<string[]> {
  const { data } = await admin.from("dealers").select("club_id").eq("club_id", clubId).limit(1);
  return [clubId];
}

async function getTableIdsForClub(admin: ReturnType<typeof createClient>, clubId: string): Promise<string[]> {
  const { data } = await admin.from("game_tables").select("id").eq("club_id", clubId).eq("status", "active");
  return (data ?? []).map((t: any) => t.id);
}
