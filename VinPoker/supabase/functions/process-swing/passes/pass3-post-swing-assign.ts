import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";

export interface PostSwingPreAssignOptions {
  chatId: string | null;
  minInterSwingRestMinutes?: number;
}

export async function postSwingPreAssign(
  admin: SupabaseClient,
  clubId: string,
  newAssignmentId: string,
  tableId: string,
  options: PostSwingPreAssignOptions,
): Promise<{ assigned: boolean; dealerName?: string; reason?: string }> {
  try {
    const { data: assignment, error: fetchErr } = await admin
      .from("dealer_assignments")
      .select("id, swing_due_at, version, table_id, game_tables!inner(table_name)")
      .eq("id", newAssignmentId)
      .single();

    if (fetchErr || !assignment) {
      console.warn(
        `[Post-swing] Failed to fetch assignment ${newAssignmentId}: ${fetchErr?.message || "not found"}`
      );
      return { assigned: false, reason: "assignment not found" };
    }

    const nextDealer = await pickNextDealer(admin, clubId, {
      currentTableId: tableId,
      swingDueAt: assignment.swing_due_at,
      minInterSwingRestMinutes: options.minInterSwingRestMinutes ?? 10,
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
      try {
        await admin.from("pre_announce_jobs").insert({
          club_id: clubId,
          table_id: tableId,
          assignment_id: newAssignmentId,
          attendance_id: nextDealer.id,
          table_name: (assignment.game_tables as any)?.table_name || "Unknown",
          in_dealer_name: nextDealer.full_name,
          swing_at: assignment.swing_due_at,
          minutes_left: Math.floor(
            (new Date(assignment.swing_due_at).getTime() - Date.now()) / 60_000
          ),
          chat_id: options.chatId,
          status: "pending",
          max_attempts: 3,
        });
      } catch (notiErr) {
        console.warn(
          `[Post-swing] Failed to enqueue notification: ${notiErr instanceof Error ? notiErr.message : String(notiErr)}`
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
