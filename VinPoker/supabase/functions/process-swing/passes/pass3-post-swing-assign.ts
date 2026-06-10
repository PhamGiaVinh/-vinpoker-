import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";
import { sendPreAssignTelegramWithFallback } from "../../_shared/preAssignTelegram.ts";

export interface PostSwingPreAssignOptions {
  chatId: string | null;
  botToken?: string | null;
  minInterSwingRestMinutes?: number;
}

export async function postSwingPreAssign(
  admin: any,
  clubId: string,
  newAssignmentId: string,
  tableId: string,
  options: PostSwingPreAssignOptions,
): Promise<{ assigned: boolean; dealerName?: string; reason?: string }> {
  try {
    const { data: assignment, error: fetchErr } = await admin
      .from("dealer_assignments")
      .select(`
        id, swing_due_at, version, table_id,
        game_tables!inner(table_name),
        dealer_attendance!attendance_id(
          id,
          dealers!inner(full_name, telegram_username, telegram_user_id)
        )
      `)
      .eq("id", newAssignmentId)
      .single();

    if (fetchErr || !assignment) {
      console.warn(
        `[Post-swing] Failed to fetch assignment ${newAssignmentId}: ${fetchErr?.message || "not found"}`
      );
      return { assigned: false, reason: "assignment not found" };
    }

    const minInterSwingRestMinutes = options.minInterSwingRestMinutes ?? 10;
    const reservationSwingAt = new Date(
      new Date(assignment.swing_due_at).getTime() + minInterSwingRestMinutes * 60_000
    ).toISOString();
    const nextDealer = await pickNextDealer(admin, clubId, {
      currentTableId: tableId,
      swingDueAt: reservationSwingAt,
      minInterSwingRestMinutes,
      reservationMode: true,
    });

    if (!nextDealer) {
      console.log(
        `[Post-swing] No dealer available immediately for assignment ${newAssignmentId}. ` +
        `Will catch in next Pass 2 window.`
      );
      return { assigned: false, reason: "no dealer available" };
    }

    const { data: rpcResult, error: rpcErr } = await admin.rpc(
      "pre_assign_next_dealer_for_table",
      {
        p_assignment_id: newAssignmentId,
        p_club_id: clubId,
        p_next_attendance_id: nextDealer.id,
        p_version: assignment.version,
      }
    );

    if (rpcErr) {
      console.warn(
        `[Post-swing] RPC failed for assignment ${newAssignmentId}: ${rpcErr.message}`
      );
      return { assigned: false, reason: rpcErr.message };
    }

    if (rpcResult?.outcome !== "pre_assigned") {
      console.log(
        `[Post-swing] RPC returned outcome="${rpcResult?.outcome}" for assignment ${newAssignmentId}`
      );
      return { assigned: false, reason: rpcResult?.outcome ?? "unknown" };
    }

    if (options.chatId) {
      const outgoingDealer = ((assignment as any).dealer_attendance as any)?.dealers ?? {};
      const outgoingAtt = (assignment as any).dealer_attendance ?? {};
      const notification = await sendPreAssignTelegramWithFallback(
        admin,
        {
          clubId,
          tableId,
          assignmentId: newAssignmentId,
          attendanceId: nextDealer.id,
          outAttendanceId: outgoingAtt.id ?? null,
          tableName: (assignment.game_tables as any)?.table_name || "Unknown",
          zone: null,
          outName: outgoingDealer.full_name ?? "Unknown",
          outUsername: outgoingDealer.telegram_username ?? null,
          outTelegramUserId: outgoingDealer.telegram_user_id ?? null,
          inName: nextDealer.full_name,
          inUsername: nextDealer.telegram_username ?? null,
          inTelegramUserId: nextDealer.telegram_user_id ?? null,
          swingAt: new Date(assignment.swing_due_at),
          minutesLeft: Math.floor(
            (new Date(assignment.swing_due_at).getTime() - Date.now()) / 60_000
          ),
          restDeficitMin: 0,
          chatId: options.chatId,
        },
        options.botToken,
        "[Post-swing]",
      );

      if (!notification.delivered && !notification.queued) {
        console.warn(
          `[Post-swing] ⚠️ Notification lost for assignment ${newAssignmentId}: ` +
          `direct=${notification.directError ?? "unknown"}, fallback=${notification.fallbackError ?? "none"}`
        );
      }
    }

    console.log(
      `[Post-swing] ✅ Pre-assigned ${nextDealer.full_name} immediately for next swing ` +
      `(assignment=${newAssignmentId.substring(0, 8)}...)`
    );

    return { assigned: true, dealerName: nextDealer.full_name };
  } catch (err) {
    console.error(
      `[Post-swing] ❌ Unexpected error for assignment ${newAssignmentId}:`,
      err instanceof Error ? err.stack : String(err)
    );
    return { assigned: false, reason: String(err) };
  }
}
