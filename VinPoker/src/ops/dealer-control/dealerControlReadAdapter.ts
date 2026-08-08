import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type DealerControlTableRead = {
  id: string;
  name: string;
  tableType: string;
  status: string;
  dealerName: string | null;
  dealerTier: string | null;
  swingDueAt: string | null;
  needsReplacement: boolean;
};

export type DealerControlReadModel = {
  tables: DealerControlTableRead[];
  checkedIn: number;
  available: number;
  assigned: number;
  onBreak: number;
  loadedAt: string;
};

type OpsClient = SupabaseClient<Database>;

export async function loadDealerControlReadModel(
  client: OpsClient,
  clubId: string,
): Promise<DealerControlReadModel> {
  const [tableResult, dealerResult] = await Promise.all([
    client
      .from("game_tables")
      .select("id, table_name, table_type, status")
      .eq("club_id", clubId)
      .neq("status", "inactive")
      .order("table_name", { ascending: true })
      .limit(200),
    client
      .from("dealers")
      .select("id, full_name, tier")
      .eq("club_id", clubId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(500),
  ]);
  if (tableResult.error) throw new Error("DEALER_TABLE_READ_FAILED");
  if (dealerResult.error) throw new Error("DEALER_ROSTER_READ_FAILED");

  const tableIds = (tableResult.data ?? []).map((row) => row.id);
  const dealerIds = (dealerResult.data ?? []).map((row) => row.id);
  const [assignmentResult, attendanceResult] = await Promise.all([
    tableIds.length
      ? client
          .from("dealer_assignments")
          .select("id, table_id, dealer_id, swing_due_at, status, needs_replacement, assigned_at")
          .eq("club_id", clubId)
          .eq("status", "assigned")
          .in("table_id", tableIds)
          .order("assigned_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    dealerIds.length
      ? client
          .from("dealer_attendance")
          .select("dealer_id, current_state, check_in_time")
          .eq("status", "checked_in")
          .in("dealer_id", dealerIds)
          .order("check_in_time", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignmentResult.error) throw new Error("DEALER_ASSIGNMENT_READ_FAILED");
  if (attendanceResult.error) throw new Error("DEALER_ATTENDANCE_READ_FAILED");

  const dealerById = new Map((dealerResult.data ?? []).map((dealer) => [dealer.id, dealer]));
  const assignmentByTable = new Map<string, (typeof assignmentResult.data)[number]>();
  for (const assignment of assignmentResult.data ?? []) {
    if (!assignmentByTable.has(assignment.table_id)) assignmentByTable.set(assignment.table_id, assignment);
  }
  const latestAttendanceByDealer = new Map<string, string | null>();
  for (const attendance of attendanceResult.data ?? []) {
    if (!latestAttendanceByDealer.has(attendance.dealer_id)) {
      latestAttendanceByDealer.set(attendance.dealer_id, attendance.current_state);
    }
  }
  const states = [...latestAttendanceByDealer.values()];

  return {
    tables: (tableResult.data ?? []).map((table) => {
      const assignment = assignmentByTable.get(table.id);
      const dealer = assignment?.dealer_id ? dealerById.get(assignment.dealer_id) : null;
      return {
        id: table.id,
        name: table.table_name,
        tableType: table.table_type,
        status: table.status,
        dealerName: dealer?.full_name ?? null,
        dealerTier: dealer?.tier ?? null,
        swingDueAt: assignment?.swing_due_at ?? null,
        needsReplacement: assignment?.needs_replacement ?? false,
      };
    }),
    checkedIn: states.length,
    available: states.filter((state) => state === "available").length,
    assigned: states.filter((state) => state === "assigned" || state === "pre_assigned").length,
    onBreak: states.filter((state) => state === "on_break").length,
    loadedAt: new Date().toISOString(),
  };
}
