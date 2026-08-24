import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, jsonResponse, pickNextDealer } from "../_shared/dealer-utils.ts";
import {
  sendTelegramNotification, getClubTelegramChatId, mention, notifyDealerDM,
} from "../_shared/telegram.ts";
import { authenticateUser } from "../_shared/staking-common.ts";
import { mapWithConcurrency } from "../_shared/mapWithConcurrency.ts";
import { requiresStaleCheckoutCleanup } from "../_shared/checkoutSafety.ts";

const CHECKOUT_BATCH_CONCURRENCY = 3;

interface AttendanceRow {
  id: string;
  dealer_id: string;
  status: string;
  current_state: string;
  shift_id: string | null;
  check_in_time: string | null;
  pre_assigned_table_id: string | null;
}

interface DealerRow {
  id: string;
  club_id: string;
  full_name: string;
  telegram_username: string | null;
  telegram_user_id: string | null;
}

interface TableNameRow {
  table_name: string | null;
}

interface AssignmentIdRow {
  id: string;
}

interface BreakRow {
  id: string;
  assignment_id: string | null;
  attendance_id: string | null;
  break_start: string;
  break_end: string | null;
}

interface TxResultRow {
  ok?: boolean;
  error?: string;
  outcome?: string;
  assignment_id?: string | null;
  idempotent?: boolean;
  orphan_count?: number;
}

interface ClubSettingsRow {
  floor_manager_chat_id: string | null;
}

interface TableTypeRow {
  table_type: string | null;
}

interface SwingConfigRow {
  swing_duration_minutes: number | null;
}

async function processOneCheckout(
  admin: any,
  botToken: string,
  uid: string,
  attendanceId: string,
): Promise<Record<string, unknown>> {
  // 1. Get attendance info
  const { data: att, error: attErr } = (await admin
    .from("dealer_attendance")
    .select("id, dealer_id, status, current_state, shift_id, check_in_time, pre_assigned_table_id")
    .eq("id", attendanceId)
    .single()) as unknown as { data: AttendanceRow | null; error: { message: string } | null };

  if (attErr) return { attendance_id: attendanceId, success: false, error: `DB error: ${attErr.message}` };
  if (!att) return { attendance_id: attendanceId, success: false, error: "Attendance not found" };
  if (att.status !== "checked_in") {
    return { attendance_id: attendanceId, success: false, error: "Dealer không trong trạng thái check-in" };
  }

  // 1b. Get dealer info (separate query to avoid join syntax issues)
  const { data: dealer, error: dealerErr } = (await admin
    .from("dealers")
    .select("id, full_name, club_id, telegram_username, telegram_user_id")
    .eq("id", att.dealer_id)
    .single()) as unknown as { data: DealerRow | null; error: { message: string } | null };

  if (dealerErr) {
    return { attendance_id: attendanceId, success: false, error: `Dealer lookup failed: ${dealerErr.message}` };
  }
  if (!dealer) {
    return { attendance_id: attendanceId, success: false, error: "Dealer not found" };
  }

  const clubId = dealer?.club_id ?? "";
  const dealerName = dealer?.full_name ?? "";
  const dealerMention = mention({
    full_name: dealerName,
    telegram_username: dealer?.telegram_username ?? null,
    telegram_user_id: dealer?.telegram_user_id ? Number(dealer.telegram_user_id) : null,
  });
  const checkInTime = att.check_in_time;

  // Normal checkout calculates worked time and overtime from check-in until now.
  // Old or invalid attendance must use the separately owner-gated stale cleanup
  // path so a retry cannot turn weeks of stale test data into payroll minutes.
  if (requiresStaleCheckoutCleanup(checkInTime)) {
    return {
      attendance_id: attendanceId,
      success: false,
      code: "STALE_ATTENDANCE_REQUIRES_CLEANUP",
      error: "Ca check-in quá 24 giờ hoặc thiếu giờ vào; hãy dùng chế độ dọn ca treo để không tính lại lương/OT",
    };
  }

  // Auth check for first item only (caller already verified for this club)
  // All items in a batch are expected to belong to the same club

  let releasedPreAssigned = false;
  let preAssignedTableName: string | null = null;
  let preAssignedDealerName: string | null = null;

  // 2. Atomic cleanup: release pre_assigned nếu dealer đang ở state pre_assigned
  const wasPreAssigned = (att as any).current_state === "pre_assigned";

  if (wasPreAssigned) {
    preAssignedDealerName = dealerName;

    // Get table name trước khi cleanup
    const { data: tableInfo } = (await admin
      .from("game_tables")
      .select("table_name")
      .eq("id", (att as any).pre_assigned_table_id)
      .maybeSingle()) as unknown as { data: TableNameRow | null };
    preAssignedTableName = tableInfo?.table_name ?? null;

    await admin.rpc("transition_dealer_state", {
      p_attendance_id: attendanceId,
      p_new_state: "available",
      p_reason: "checkout_release_pre_assign",
    });

    await admin
      .from("dealer_attendance")
      .update({ pre_assigned_table_id: null, pre_assigned_at: null })
      .eq("id", attendanceId);

    // Cleanup dealer_assignments
    await admin
      .from("dealer_assignments")
      .update({
        pre_assigned_attendance_id: null,
        pre_assigned_at: null,
      })
      .eq("pre_assigned_attendance_id", attendanceId)
      .eq("status", "assigned");

    releasedPreAssigned = true;
  }

  // ── Compute overtime minutes at checkout ──────────────────────────
  // TODO: move STANDARD_SHIFT_MINUTES to club_settings for per-club configurability
  const STANDARD_SHIFT_MINUTES = 480;

  let overtimeMinutes = 0;
  let workedMinutes = 0;
  let totalHours = 0;

  if (checkInTime) {
    const checkInMs = new Date(checkInTime).getTime();
    const nowMs = Date.now();
    const totalMinutes = Math.round((nowMs - checkInMs) / 60000);

    // Subtract break time from both assignment-linked and attendance-linked rows.
    const { data: assignments, error: assignmentsErr } = (await admin
      .from("dealer_assignments")
      .select("id")
      .eq("attendance_id", attendanceId)) as unknown as {
        data: AssignmentIdRow[] | null;
        error: { message: string } | null;
      };
    if (assignmentsErr) {
      return { attendance_id: attendanceId, success: false, error: `Assignment lookup failed: ${assignmentsErr.message}` };
    }
    const assignmentIds = (assignments ?? []).map((a) => a.id);

    const [attendanceBreakResult, assignmentBreakResult] = (await Promise.all([
      admin
        .from("dealer_breaks")
        .select("id, assignment_id, attendance_id, break_start, break_end")
        .eq("attendance_id", attendanceId)
        .not("break_end", "is", null),
      assignmentIds.length > 0
        ? admin
            .from("dealer_breaks")
            .select("id, assignment_id, attendance_id, break_start, break_end")
            .in("assignment_id", assignmentIds)
            .not("break_end", "is", null)
        : Promise.resolve({ data: [], error: null }),
    ])) as [
      { data: BreakRow[] | null; error: { message: string } | null },
      { data: BreakRow[] | null; error: { message: string } | null },
    ];

    if (attendanceBreakResult.error) {
      return { attendance_id: attendanceId, success: false, error: `DB error: ${attendanceBreakResult.error.message}` };
    }
    if (assignmentBreakResult.error) {
      return { attendance_id: attendanceId, success: false, error: `DB error: ${assignmentBreakResult.error.message}` };
    }

    const breaksById = new Map<string, { break_start: string; break_end: string | null }>();
    for (const b of [...(attendanceBreakResult.data ?? []), ...(assignmentBreakResult.data ?? [])]) {
      breaksById.set(b.id, { break_start: b.break_start, break_end: b.break_end });
    }

    const totalBreakMinutes = [...breaksById.values()].reduce((sum: number, b: { break_start: string; break_end: string | null }) => {
      const duration = Math.round(
        ((b.break_end ? new Date(b.break_end).getTime() : Date.now()) - new Date(b.break_start).getTime()) / 60000
      );
      return sum + Math.max(duration, 0);
    }, 0);

    workedMinutes = totalMinutes - totalBreakMinutes;
    overtimeMinutes = Math.max(0, workedMinutes - STANDARD_SHIFT_MINUTES);
    totalHours = Math.round(workedMinutes / 6) / 10;
  }

  // 3. State transition via RPC (validated + audited)
  const { data: txResult, error: txErr } = (await admin.rpc("transition_dealer_state", {
      p_attendance_id: attendanceId,
      p_new_state: "checked_out",
      p_reason: "dealer_checkout",
    })) as unknown as { data: TxResultRow | null; error: { message: string } | null };
  if (txErr) {
    return { attendance_id: attendanceId, success: false, error: `State transition DB error: ${txErr.message}` };
  }
  if (!txResult) {
    return { attendance_id: attendanceId, success: false, error: "State transition returned no result" };
  }
  if (txResult?.ok === false) {
    return { attendance_id: attendanceId, success: false, error: `State transition failed: ${txResult.error}` };
  }

  // 4. Update non-state fields (checkout time, status, OT, cleanup)
  const nowISO = new Date().toISOString();
  const { data: checkoutRow, error: checkoutErr } = (await admin
    .from("dealer_attendance")
    .update({
      status: "checked_out",
      check_out_time: nowISO,
      pre_assigned_table_id: null,
      pre_assigned_at: null,
      overtime_minutes: overtimeMinutes,
      worked_minutes_since_last_break: 0,
      total_worked_minutes_today: workedMinutes,
    })
    .eq("id", attendanceId)
    .eq("status", "checked_in")
    .select("id")
    .maybeSingle()) as unknown as {
      data: { id: string } | null;
      error: { message: string } | null;
    };   // anti-double-checkout guard

  if (checkoutErr) {
    return { attendance_id: attendanceId, success: false, error: `Checkout update failed: ${checkoutErr.message}` };
  }
  if (!checkoutRow) {
    const { data: current, error: currentErr } = (await admin
      .from("dealer_attendance")
      .select("status, check_out_time")
      .eq("id", attendanceId)
      .maybeSingle()) as unknown as {
        data: { status: string; check_out_time: string | null } | null;
        error: { message: string } | null;
      };
    if (currentErr) {
      return { attendance_id: attendanceId, success: false, error: `Checkout verification failed: ${currentErr.message}` };
    }
    if (current?.status === "checked_out") {
      return {
        attendance_id: attendanceId,
        success: true,
        idempotent: true,
        dealer_name: dealerName,
        check_in_time: checkInTime,
        check_out_time: current.check_out_time,
      };
    }
    return { attendance_id: attendanceId, success: false, error: "Checkout conflict: attendance was not updated" };
  }

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

  // 4. Telegram: gửi thông báo checkout tới group chat
  if (botToken) {
    try {
      const groupChatId = await getClubTelegramChatId(admin, clubId);
      if (groupChatId) {
        const checkInStr = checkInTime ? fmtTime(new Date(checkInTime)) : "?";
        const checkOutStr = fmtTime(new Date(nowISO));
        const msg = `${dealerMention} check out - thời gian làm việc ${checkInStr}-${checkOutStr}: ${totalHours} tiếng`;
        await sendTelegramNotification(botToken, groupChatId, msg).catch(() => {});
      }
    } catch { /* non-critical */ }

    // 4b. Private DM to the dealer (owner rule: notify the dealer on check-out).
    // Uses notifyDealerDM (HTML parse mode, same as the working break/meal DM flows) so the
    // bold renders correctly. A DM REQUIRES the dealer's numeric telegram_user_id, which Telegram
    // only exposes once the dealer has messaged the bot (/checkin or /start) — a bot cannot DM a
    // user it has only as an @username. We log exactly why a DM did/didn't go so the gap is visible.
    if (dealer?.telegram_user_id) {
      const ci = checkInTime ? fmtTime(new Date(checkInTime)) : "?";
      const co = fmtTime(new Date(nowISO));
      const dm =
        `✅ Bạn đã được <b>check-out</b> lúc ${co}.\n` +
        `🕒 Thời gian làm việc: ${ci}–${co} (${totalHours} tiếng).\n` +
        `Cảm ơn ca làm việc của bạn!`;
      const ok = await notifyDealerDM(
        botToken,
        { telegram_user_id: Number(dealer.telegram_user_id), full_name: dealerName },
        dm,
      );
      console.log(
        `[checkout-dealer] DM ${dealerName} (uid=${dealer.telegram_user_id}): ` +
        (ok ? "sent" : "FAILED (dealer likely has not started the bot / blocked it)"),
      );
    } else {
      console.warn(
        `[checkout-dealer] DM skipped — dealer ${dealerName} (id=${dealer?.id}) has no telegram_user_id. ` +
        `They must message the bot once (/checkin or /start) so Telegram exposes their chat id; ` +
        `an operator-linked @username alone cannot receive a DM.`,
      );
    }

    // If pre_assigned → also send alerts (existing behavior)
    if (releasedPreAssigned) {
      const { data: cs } = (await admin
        .from("club_settings")
        .select("floor_manager_chat_id")
        .eq("club_id", clubId)
        .maybeSingle()) as unknown as { data: ClubSettingsRow | null };

      const fmChatId = (cs as any)?.floor_manager_chat_id;
      if (fmChatId) {
        await sendTelegramNotification(botToken, fmChatId,
          `🚨 *Check-out đột ngột!*\n\n${dealerMention} (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}) vừa check-out.\nCần gán dealer mới cho bàn này!`,
          { logError: (err) => console.error("checkout FM alert error:", err) }
        ).catch(() => {});
      }

      const groupChatId2 = await getClubTelegramChatId(admin, clubId);
      if (groupChatId2) {
        await sendTelegramNotification(botToken, groupChatId2,
          `⚠️ ${dealerMention} vừa check-out (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}).`
        ).catch(() => {});
      }
    }
  }

  // 5. BUG 3 FIX: Release active dealer_assignment for this attendance
  // so the table is no longer considered "occupied" by fillEmptyTables.
  // Set needs_replacement=true so process-swing prioritizes refilling it.
  let needsReplacementTableId: string | null = null;
  // Release ALL active dealer_assignments for this attendance — not just
  // status='assigned'. A dealer can hold an on_break / pre_assigned row that, if
  // left with released_at IS NULL, becomes an orphan poisoning pickNextDealer
  // Step 5b (matched by dealer_id) and can freeze the club rotation (the pgv
  // incident). Only an actively 'assigned' table needs a replacement.
  // (Canonical teardown is release_dealer_assignments(); kept inline here to stay
  // deploy-safe — this edge fn auto-deploys on push while that RPC applies under
  // owner-gated control. Route through the RPC once it is live.)
      const { data: activeAss } = (await admin
        .from("dealer_assignments")
        .select("id, table_id, status")
        .eq("attendance_id", attendanceId)
        .in("status", ["assigned", "on_break", "pre_assigned"])
        .is("released_at", null)) as unknown as { data: Array<{ id: string; table_id: string | null; status: string }> | null };

  if (activeAss && activeAss.length > 0) {
    const activeTable = activeAss.find((a) => a.status === "assigned");
    needsReplacementTableId = activeTable?.table_id ?? null;
    await admin
      .from("dealer_assignments")
      .update({
        released_at: nowISO,
        status: "completed",
        needs_replacement: true,
      })
      .eq("attendance_id", attendanceId)
      .in("status", ["assigned", "on_break", "pre_assigned"])
      .is("released_at", null);
  }

  // 6. BUG 3: Best-effort auto-replacement for the affected table.
  // If a dealer is available, assign immediately. If not, cron will
  // handle it through fillEmptyTables on the next cycle.
  let autoAssigned: { dealer_name: string } | null = null;
  if (needsReplacementTableId && botToken) {
    try {
      // minInterSwingRestMinutes: 0 — checkout is an emergency replacement;
      // the dealer is leaving the shift entirely, so the replacement should
      // be picked immediately without cooldown. The replacement's
      // last_released_at will be set when they finish their swing (via
      // perform_swing), so subsequent picks WILL respect the cooldown.
      const dealer = await pickNextDealer(admin, clubId, {
        currentTableId: needsReplacementTableId,
        minInterSwingRestMinutes: 0,
      });
      if (dealer) {
        // Compute swing_due_at from swing_config (table_type-aware fallback chain)
        let swingMinutes: number | null = null;
        const { data: tableInfo } = (await admin
          .from("game_tables")
          .select("table_type")
          .eq("id", needsReplacementTableId)
          .maybeSingle()) as unknown as { data: TableTypeRow | null };

        if (tableInfo?.table_type) {
          const { data: swingConfig } = (await admin
            .from("swing_config")
            .select("swing_duration_minutes")
            .eq("club_id", clubId)
            .eq("table_type", tableInfo.table_type)
            .maybeSingle()) as unknown as { data: SwingConfigRow | null };
          swingMinutes = swingConfig?.swing_duration_minutes ?? null;
        }

        if (swingMinutes == null) {
          const { data: fallbackConfig } = (await admin
            .from("swing_config")
            .select("swing_duration_minutes")
            .eq("club_id", clubId)
            .limit(1)
            .maybeSingle()) as unknown as { data: SwingConfigRow | null };
          swingMinutes = fallbackConfig?.swing_duration_minutes ?? null;
        }

        const replacementSwingDueAt = new Date(
          Date.now() + (swingMinutes ?? 45) * 60_000
        ).toISOString();

        const { data: assignResult, error: assignErr } = (await admin.rpc(
          "assign_dealer_to_table",
          {
            p_attendance_id: dealer.id,
            p_table_id: needsReplacementTableId,
            p_swing_due_at: replacementSwingDueAt,
          }
        )) as unknown as { data: TxResultRow | string | null; error: { message: string } | null };
        if (assignErr) {
          console.error(`[checkout-dealer] Auto-replace RPC error: ${assignErr.message}`);
        } else {
          const assignOutcome = typeof assignResult === "string" ? assignResult : assignResult?.outcome;
          if (assignOutcome === "ok") {
            autoAssigned = { dealer_name: dealer.full_name };
            console.log(
              `[checkout-dealer] Auto-assigned ${dealer.full_name} to table ${needsReplacementTableId}`
            );
          } else {
            console.warn(`[checkout-dealer] Auto-replace outcome: ${assignOutcome}`);
          }
        }
      }
    } catch (err: any) {
      console.error(
        `[checkout-dealer] Auto-replace failed for table ${needsReplacementTableId}:`,
        err.message
      );
    }

    // If auto-assign failed, notify floor manager
    if (!autoAssigned) {
      try {
        const { data: cs } = (await admin
          .from("club_settings")
          .select("floor_manager_chat_id")
          .eq("club_id", clubId)
          .maybeSingle()) as unknown as { data: ClubSettingsRow | null };
        const fmChatId = (cs as any)?.floor_manager_chat_id;
        if (fmChatId) {
          await sendTelegramNotification(
            botToken,
            fmChatId,
            `⚠️ Bàn vừa mất dealer (check-out) — chưa có người thay. Hệ thống sẽ tự động xoay vòng.`,
            {}
          ).catch(() => {});
        }
      } catch {
        /* non-critical */
      }
    }
  }

  // 7. Audit log
  void admin.from("audit_logs").insert({
    club_id: clubId,
    actor_id: uid,
    action: "checkout_dealer",
    entity_type: "dealer_attendance",
    entity_id: attendanceId,
    payload: {
      dealer_name: dealerName,
      was_pre_assigned: wasPreAssigned,
      released_pre_assigned: releasedPreAssigned,
      pre_assigned_table: preAssignedTableName,
      needs_replacement_table: needsReplacementTableId,
      auto_assigned: autoAssigned?.dealer_name ?? null,
    },
  });

  return {
    attendance_id: attendanceId,
    success: true,
    dealer_name: dealerName,
    check_in_time: checkInTime,
    check_out_time: nowISO,
    total_hours: totalHours,
    released_pre_assigned: releasedPreAssigned,
    pre_assigned_table: preAssignedTableName,
    needs_replacement_table: needsReplacementTableId,
    auto_assigned_dealer: autoAssigned?.dealer_name ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authResult = await authenticateUser(req);
    if (authResult instanceof Response) return authResult;
    const uid = authResult.uid;

    const body = await req.json();
    const mode = body.mode === "stale_cleanup" ? "stale_cleanup" : "normal";
    const ids: string[] = Array.from(new Set<string>(
      (body.attendance_ids || (body.attendance_id ? [body.attendance_id] : []))
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    ));
    if (!ids.length) return jsonResponse({ error: "attendance_id or attendance_ids required" }, 400);
    if (ids.length > 100) return jsonResponse({ error: "Too many attendance_ids" }, 400);

    // Resolve and validate every dealer's club before any checkout mutation.
    // Checking only ids[0] allowed a mixed-club batch to cross the caller's scope.
    const { data: rows, error: attendanceErr } = await admin
      .from("dealer_attendance")
      .select("id, dealer_id, dealers!inner(club_id)")
      .in("id", ids) as unknown as {
        data: Array<{ id: string; dealer_id: string; dealers: { club_id: string } | Array<{ club_id: string }> }> | null;
        error: { message: string } | null;
      };
    if (attendanceErr) return jsonResponse({ error: `Cannot determine attendance scope: ${attendanceErr.message}` }, 500);
    if (!rows || rows.length !== ids.length) return jsonResponse({ error: "One or more attendance records not found" }, 404);

    const clubIds = new Set(rows.map((row) => {
      const dealer = Array.isArray(row.dealers) ? row.dealers[0] : row.dealers;
      return dealer?.club_id;
    }).filter((clubId): clubId is string => Boolean(clubId)));
    if (clubIds.size !== 1) return jsonResponse({ error: "Mixed-club checkout batches are not allowed" }, 403);
    const clubId = [...clubIds][0];

    const { data: isControl, error: controlErr } = await admin
      .rpc("is_club_dealer_control", { _user_id: uid, _club_id: clubId });
    if (controlErr) return jsonResponse({ error: `Cannot verify dealer-control scope: ${controlErr.message}` }, 500);
    if (!isControl) return jsonResponse({ error: "Forbidden" }, 403);

    if (mode === "stale_cleanup") {
      const { data: cleanupResults, error: cleanupErr } = (await admin.rpc(
        "administrative_close_stale_dealer_attendance",
        { p_attendance_ids: ids, p_actor_id: uid },
      )) as unknown as { data: unknown; error: { message: string } | null };

      if (cleanupErr) {
        console.error("[checkout-dealer] stale cleanup RPC failed", cleanupErr.message);
        return jsonResponse({ error: `Stale cleanup failed: ${cleanupErr.message}` }, 500);
      }

      const results = Array.isArray(cleanupResults) ? cleanupResults : [];
      const failedResults = results.filter((result) => (result as { success?: boolean })?.success !== true);
      if (failedResults.length > 0) {
        console.warn(
          `[checkout-dealer] stale cleanup held ${failedResults.length}/${ids.length} rows`,
          failedResults,
        );
      }
      return jsonResponse({ mode, results });
    }

    // A checkout performs several PostgREST/RPC calls. Running up to 100 dealers
    // with Promise.allSettled creates an unbounded request fan-out and can make an
    // otherwise valid batch fail together. Keep pressure bounded and preserve order.
    const mappedResults = await mapWithConcurrency(
      ids,
      CHECKOUT_BATCH_CONCURRENCY,
      async (id: string) => {
        try {
          return await processOneCheckout(admin, botToken, uid, id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`[checkout-dealer] unhandled item failure attendance=${id}: ${message}`);
          return { attendance_id: id, success: false, error: message };
        }
      },
    );

    const failedResults = mappedResults.filter((result) => result.success !== true);
    if (failedResults.length > 0) {
      console.error(
        `[checkout-dealer] batch failed ${failedResults.length}/${ids.length}`,
        failedResults.map((result) => ({
          attendance_id: result.attendance_id,
          error: result.error ?? "Unknown error",
        })),
      );
    }

    return jsonResponse({ results: mappedResults });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
