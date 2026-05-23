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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);

    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const { table_id, force_dealer_id, requested_by, idempotency_key, return_suggestions_only, shift_id } = body ?? {};
    if (!table_id) return json({ error: "table_id required" }, 400);

    console.log(`[assign-dealer] table=${table_id} force=${force_dealer_id} shift=${shift_id} idemp=${idempotency_key}`);

    // Idempotency check
    if (idempotency_key) {
      const { data: existing } = await admin
        .from("dealer_assignments")
        .select("id, status")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) return json({ status: "already_processed", id: existing.id });
    }

    // Get table + swing config
    const { data: table, error: te } = await admin
      .from("game_tables")
      .select("id, club_id, table_name, table_type, status")
      .eq("id", table_id)
      .maybeSingle();
    if (te || !table) return json({ error: "Table not found" }, 404);
    if (table.status !== "active") return json({ error: "Table is not active" }, 400);

    // Check user has dealer_control for this club
    const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: table.club_id });
    if (!isControl) return json({ error: "Forbidden — not a dealer controller" }, 403);

    const { data: config } = await admin
      .from("swing_config")
      .select("*")
      .eq("club_id", table.club_id)
      .eq("table_type", table.table_type)
      .maybeSingle();

    const swingDuration = config?.swing_duration_minutes ?? 45;
    const breakDuration = config?.break_duration_minutes ?? 20;
    const breakReturnPolicy = config?.break_return_policy ?? "fifo";

    if (force_dealer_id) {
      const query = admin
        .from("dealer_attendance")
        .select("id, shift_id")
        .eq("dealer_id", force_dealer_id)
        .eq("shift_date", new Date().toISOString().split("T")[0])
        .eq("status", "checked_in");

      if (shift_id) query.eq("shift_id", shift_id);

      const { data: attendanceRows, error: ae } = await query
        .order("check_in_time", { ascending: false })
        .limit(1);

      if (ae) return json({ error: `ATTENDANCE_QUERY_FAILED: ${ae.message}` }, 500);
      if (!attendanceRows?.length) {
        const countAll = await admin
          .from("dealer_attendance")
          .select("id", { count: "exact", head: true })
          .eq("dealer_id", force_dealer_id)
          .eq("shift_date", new Date().toISOString().split("T")[0])
          .in("status", ["checked_in"]);
        console.log(`[assign-dealer] dealer ${force_dealer_id} not found (total today: ${countAll.count})`);
        return json({ error: "DEALER_NOT_CHECKED_IN: Dealer hasn't checked in today", dealer_id: force_dealer_id, shift_id }, 400);
      }

      const attendance = attendanceRows[0];

      const { data: assignment, error: ase } = await admin
        .from("dealer_assignments")
        .insert({
          attendance_id: attendance.id,
          table_id,
          assigned_at: new Date().toISOString(),
          status: "assigned",
          idempotency_key: idempotency_key ?? null,
        })
        .select("id, assigned_at, status")
        .single();
      if (ase) return json({ error: ase.message }, 500);

      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: requested_by ?? uid,
        action: "assign",
        entity_type: "dealer_assignment",
        entity_id: assignment.id,
        payload: { table_id, attendance_id: attendance.id, mode: "force" },
      });

      return json({ assignment, status: "success" });
    }

    // Fair Rotation Algorithm — return suggestions
    const suggestions = await fairRotation(admin, table_id, table.table_type, table.club_id, swingDuration, breakReturnPolicy);

    if (return_suggestions_only) {
      return json({ suggestions });
    }

    if (!suggestions.length) {
      return json({ error: "NO_DEALERS_AVAILABLE: No dealers checked in and available" });
    }

    return json({ suggestions });
  } catch (e) {
    return json({ error: `INTERNAL_ERROR: ${(e as Error).message}` }, 500);
  }
});

interface ScoredDealer {
  attendance_id: string;
  dealer_id: string;
  dealer_name: string;
  tier: string;
  score: number;
  worked_minutes: number;
  reason: string;
}

async function fairRotation(
  admin: ReturnType<typeof createClient>,
  tableId: string,
  tableType: string,
  clubId: string,
  swingDuration: number,
  breakReturnPolicy: string,
): Promise<ScoredDealer[]> {
  const today = new Date().toISOString().split("T")[0];

  // Get all checked-in dealers for this club today
  const { data: checkedIn } = await admin
    .from("dealer_attendance")
    .select(`
      id,
      dealer_id,
      dealers!inner(id, full_name, tier, status)
    `)
    .eq("shift_date", today)
    .eq("status", "checked_in")
    .in("dealers.club_id", [clubId]);

  if (!checkedIn?.length) return [];

  const dealerIds = checkedIn.map((c: any) => c.dealer_id);

  // Exclude dealers currently assigned (status = 'assigned' or 'on_break')
  const { data: activeAssignments } = await admin
    .from("dealer_assignments")
    .select("attendance_id")
    .in("status", ["assigned", "on_break"])
    .in("attendance_id", checkedIn.map((c: any) => c.id));

  const busyAttendanceIds = new Set((activeAssignments ?? []).map((a: any) => a.attendance_id));

  const available = checkedIn.filter((c: any) => !busyAttendanceIds.has(c.id));

  if (!available.length) return [];

  // Get worked times
  const { data: workTimes } = await admin.rpc("get_dealer_worked_times", { p_shift_date: today });

  // Get last table per dealer (to avoid same-table-back-to-back)
  const { data: lastTables } = await admin.rpc("get_dealer_last_tables", { p_dealer_ids: dealerIds });

  // Get skills
  const { data: allSkills } = await admin
    .from("dealer_skills")
    .select("dealer_id, game_type")
    .in("dealer_id", dealerIds);

  const skillsMap: Record<string, string[]> = {};
  for (const s of allSkills ?? []) {
    const sid = (s as any).dealer_id;
    if (!skillsMap[sid]) skillsMap[sid] = [];
    skillsMap[sid].push((s as any).game_type);
  }

  const scored: ScoredDealer[] = available.map((c: any) => {
    const dealer = c.dealers;
    let score = 0;
    const workedMin = (workTimes ?? []).find((w: any) => w.dealer_id === dealer.id)?.total_minutes ?? 0;
    const lastTable = (lastTables ?? []).find((l: any) => l.dealer_id === dealer.id)?.table_id;
    const skills = skillsMap[dealer.id] ?? [];

    // Tier scoring
    if (tableType === "vip") {
      if (dealer.tier === "A") score += 10;
      else return null;
    } else if (tableType === "tournament") {
      if (dealer.tier === "A") score += 6;
      else if (dealer.tier === "B") score += 4;
      else score += 1;
      if (!skills.includes("Tournament")) score -= 3;
    } else {
      if (dealer.tier === "A") score += 4;
      else if (dealer.tier === "B") score += 3;
      else score += 2;
    }

    // Fairness: less worked time = higher priority
    score -= Math.floor(workedMin / 30);

    // Avoid same table back-to-back
    if (lastTable === tableId) score -= 5;

    // Skill bonuses
    if (tableType === "plo" && skills.includes("PLO")) score += 3;
    if (tableType === "cash" && skills.includes("NLH")) score += 2;
    if (tableType === "tournament" && skills.includes("Mixed")) score += 2;

    const reasons: string[] = [];
    if (dealer.tier === "A" && tableType === "vip") reasons.push("Hạng A phù hợp bàn VIP");
    else if (dealer.tier === "A") reasons.push("Dealer hạng A ưu tiên");
    else if (dealer.tier === "B") reasons.push("Hạng B – phù hợp");
    if (workedMin < 30) reasons.push("Thời gian làm ít nhất");
    if (skills.includes("PLO") && tableType === "plo") reasons.push("Có kỹ năng PLO");
    if (skills.includes("Tournament") && tableType === "tournament") reasons.push("Có chứng chỉ Tournament");

    return {
      attendance_id: c.id,
      dealer_id: dealer.id,
      dealer_name: dealer.full_name,
      tier: dealer.tier,
      score,
      worked_minutes: workedMin,
      reason: reasons.length ? reasons.join(" · ") : "Sẵn sàng",
    };
  }).filter(Boolean) as ScoredDealer[];

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
