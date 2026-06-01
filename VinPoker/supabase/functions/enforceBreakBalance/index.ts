import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendTelegramNotification,
  getClubTelegramChatId,
  notifyDealerDM,
  formatBreakAlertMessage,
  formatForceBreakMessage,
} from "../_shared/telegram.ts";
import { getTableIdsForClub } from "../_shared/dealer-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DETECTION_BUFFER_MINUTES = 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const body = await req.json().catch(() => ({}));
  const { club_id: clubId, dry_run: dryRun = false } = body;

  let clubIds: string[] = [];
  if (clubId) {
    clubIds = [clubId];
  } else {
    const { data: clubs } = await admin
      .from("clubs")
      .select("id")
      .eq("status", "active");
    clubIds = (clubs ?? []).map((c: { id: string }) => c.id);
  }

  const summary: Record<string, { forced: number; flagged: number; errors: number }> = {};

  for (const cid of clubIds) {
    summary[cid] = { forced: 0, flagged: 0, errors: 0 };

    const { data: policy } = await admin
      .from("shift_break_policies")
      .select("max_work_before_mandatory_break_minutes")
      .eq("club_id", cid)
      .single();

    const maxWork = policy?.max_work_before_mandatory_break_minutes ?? 120;
    const detectionThreshold = maxWork - DETECTION_BUFFER_MINUTES;

    const { data: dealers } = await admin
      .from("dealer_attendance")
      .select(
        `id, current_state, worked_minutes_since_last_break, priority_break_flag,
         dealers(full_name, telegram_user_id, telegram_username, club_id)`
      )
      .eq("status", "checked_in")
      .eq("dealers.club_id", cid);

    // ── Deadlock detection: pool exhausted + swings overdue ──────────
    const availCount = (dealers ?? []).filter(
      (d: { current_state: string }) => d.current_state === "available"
    ).length;
    const assignCount = (dealers ?? []).filter(
      (d: { current_state: string }) => d.current_state === "assigned"
    ).length;

    if (availCount === 0 && assignCount > 0) {
      const { data: overdueSwings } = await admin
        .from("dealer_assignments")
        .select("id, attendance_id")
        .eq("status", "assigned")
        .lt("swing_due_at", new Date().toISOString())
        .in("table_id", await getTableIdsForClub(admin, cid));

      if ((overdueSwings ?? []).length > 0) {
        // [FIX] Replace direct state mutation with manage-break invocation.
        // Before: UPDATE dealer_attendance SET current_state='available' while
        //   dealer still has active assignment — breaks state machine invariant.
        // After: manage-break does proper CAS (version check) + dealer_breaks
        //   insert + attendance state update. Preserves invariants.
        const worstAssigned = (dealers ?? [])
          .filter((d: { current_state: string }) => d.current_state === "assigned")
          .sort(
            (a: { worked_minutes_since_last_break?: number }, b: { worked_minutes_since_last_break?: number }) =>
              (b.worked_minutes_since_last_break ?? 0) - (a.worked_minutes_since_last_break ?? 0)
          )
          .slice(0, 1);

        let freedCount = 0;

        if (!dryRun) {
          const results = await Promise.allSettled(
            worstAssigned.map(async (d) => {
              try {
                await admin.functions.invoke("manage-break", {
                  body: {
                    action: "start",
                    attendance_id: d.id,
                    duration_minutes: 15,
                    reason: "deadlock_recovery",
                    club_id: cid,
                  },
                });
                freedCount++;
              } catch (err) {
                console.error(`[enforceBreakBalance] manage-break invoke failed for ${d.id}:`, err);
                summary[cid].errors++;
              }
            })
          );
        }

        summary[cid].forced += freedCount;

        if (freedCount > 0 && botToken) {
          const chatId = await getClubTelegramChatId(admin, cid);
          if (chatId) {
            await sendTelegramNotification(
              botToken, chatId,
              `⚠️ Pool dealer cạn kiệt — ${overdueSwings!.length} bàn chờ swing.\n` +
              `Đã ép dealer lâu nhất nghỉ để xử lý hàng đợi.`,
              {}
            );
          }
        }

        console.log(`[enforceBreakBalance] Deadlock recovery for club ${cid}: ` +
          `freed ${longestAssigned.length} dealers, ${overdueSwings!.length} swings overdue`);
      }
    }

    // ── OT Display Tracking ──────────────────────────────────────────────────
    // INVARIANT: this OVERWRITES overtime_minutes, not accumulates.
    // perform_swing ACCUMULATES (+=). enforceBreakBalance DISPLAYS (=).
    // These serve different purposes:
    //   enforceBreakBalance: shows current live OT session duration
    //   perform_swing: records total OT across all sessions for payroll
    // They don't conflict because perform_swing runs at swing time (session end)
    // and immediately sets the final accumulated value, after which
    // overtime_started_at = NULL so this query no longer touches that dealer.
    if (!dryRun) {
      const { data: otAssignments } = await admin
        .from("dealer_assignments")
        .select(`
          id, attendance_id, overtime_started_at,
          game_tables!inner(club_id, table_name)
        `)
        .not("overtime_started_at", "is", null)
        .eq("status", "assigned")
        .eq("game_tables.club_id", cid);

      const otAlertLines: string[] = [];

      for (const ota of otAssignments ?? []) {
        const otMinutes = Math.floor(
          (Date.now() - new Date(ota.overtime_started_at).getTime()) / 60000
        );

        // Write to current_ot_display_minutes (display-only, overwrite-safe).
        // Payroll accumulation stays in dealer_attendance.overtime_minutes (written by perform_swing).
        await admin
          .from("dealer_attendance")
          .update({ current_ot_display_minutes: otMinutes })
          .eq("id", ota.attendance_id);

        // Alert every 30 minutes of continuous OT
        // INVARIANT: modulo check means alerts fire at 30, 60, 90... minutes
        // Because enforceBreakBalance runs every 5 minutes, the check fires
        // within 5 minutes of each 30-minute mark (e.g., fires at 30, 31, 32,
        // 33, 34 minutes — all within the same 30-min bucket).
        // To prevent 5 alerts at the 30-minute mark, add a tighter check:
        if (otMinutes >= 30 && otMinutes % 30 < 5) {
          otAlertLines.push(
            `• Bàn ${(ota as any).game_tables?.table_name ?? "?"}: ${otMinutes} phút OT`
          );
        }
      }

      // Send one batch message for all OT alerts this cycle
      if (otAlertLines.length > 0 && botToken) {
        const chatId = await getClubTelegramChatId(admin, cid);
        if (chatId) {
          await sendTelegramNotification(
            botToken, chatId,
            `📊 *Cập nhật OT:*\n${otAlertLines.join("\n")}`,
            {}
          );
        }
      }
    }

    for (const dealer of dealers ?? []) {
      try {
        const worked = dealer.worked_minutes_since_last_break ?? 0;
        if (worked < detectionThreshold) continue;

        const name = dealer.dealers?.full_name ?? "Dealer";
        const state = dealer.current_state;

        if (state === "available") {
          if (!dryRun) {
            // [FIX-EB5] Lấy active assignment_id trước (dealer.id là attendance_id, không phải assignment_id)
            const { data: activeAssignment } = await admin
              .from("dealer_assignments")
              .select("id")
              .eq("attendance_id", dealer.id)
              .eq("status", "assigned")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!activeAssignment) {
              console.warn(`[enforceBreak] No active assignment for attendance ${dealer.id} — skip`);
              continue;
            }

            // [FIX-EB6] Double-break guard — skip nếu đã có break đang mở
            const { data: existingBreak } = await admin
              .from("dealer_breaks")
              .select("id")
              .eq("assignment_id", activeAssignment.id)
              .is("break_end", null)
              .maybeSingle();

            if (existingBreak) {
              console.log(`[enforceBreak] Open break exists for ${dealer.id} — skip`);
              continue;
            }

            // [FIX-EB4] Insert với column names đúng
            const { error: insertErr } = await admin
              .from("dealer_breaks")
              .insert({
                assignment_id: activeAssignment.id,
                break_start: new Date().toISOString(),
                expected_duration_minutes: 15,
                reason: "forced_balance",
              });

            if (insertErr) {
              console.error(`[enforceBreak] Insert failed for ${dealer.id}:`, insertErr);
              summary[cid].errors++;
              continue;
            }

            const { data: stateResult } = await admin.rpc("transition_dealer_state", {
              p_attendance_id: dealer.id,
              p_new_state: "on_break",
              p_reason: "break_balance_enforced",
            });
            if (stateResult?.ok === false) {
              console.error(`[enforceBreak] State transition failed for ${dealer.id}: ${stateResult.error}`);
              summary[cid].errors++;
              continue;
            }

            await admin
              .from("dealer_attendance")
              .update({ priority_break_flag: false })
              .eq("id", dealer.id);
          }

          summary[cid].forced++;

          if (botToken) {
            const chatId = await getClubTelegramChatId(admin, cid);
            if (chatId) {
              await sendTelegramNotification(
                botToken,
                chatId,
                formatForceBreakMessage({ dealer: { full_name: name }, durationMinutes: 15, reason: "Đã làm quá lâu — force break" }),
                {}
              );
            }
            if (dealer.dealers?.telegram_user_id) {
              await notifyDealerDM(
                botToken,
                dealer.dealers.telegram_user_id,
                `☕ Bạn đã làm ${worked} phút. Vui lòng nghỉ ngơi 15 phút.`
              );
            }
          }
        } else if (state === "assigned") {
          if (!dryRun && !dealer.priority_break_flag) {
            await admin
              .from("dealer_attendance")
              .update({ priority_break_flag: true })
              .eq("id", dealer.id);
          }

          summary[cid].flagged++;

          if (botToken) {
            const chatId = await getClubTelegramChatId(admin, cid);
            if (chatId) {
              await sendTelegramNotification(
                botToken,
                chatId,
                formatBreakAlertMessage(
                  name,
                  `Đã làm ${worked} phút. Sẽ nghỉ sau swing tiếp theo.`
                ),
                {}
              );
            }
          }
        }
      } catch (err) {
        console.error(`[enforceBreak] Unexpected error for dealer ${dealer?.id ?? "unknown"}:`, err);
        summary[cid].errors++;
        continue;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Internal error", detail: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
