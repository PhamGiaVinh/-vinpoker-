import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(url, service);

    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const { request_id, action, rejection_reason } = body ?? {};
    if (!request_id || !["approve", "reject"].includes(action)) {
      return json({ error: "Invalid input" }, 400);
    }
    if (action === "reject" && !String(rejection_reason ?? "").trim()) {
      return json({ error: "rejection_reason required" }, 400);
    }

    const { data: reqRow, error: re } = await admin
      .from("membership_verification_requests")
      .select("id, club_id, player_user_id, status")
      .eq("id", request_id)
      .maybeSingle();
    if (re || !reqRow) return json({ error: "Not found" }, 404);
    if (reqRow.status !== "pending") return json({ error: "Already reviewed" }, 400);

    const { data: ok } = await admin.rpc("is_club_cashier", {
      _user_id: uid,
      _club_id: reqRow.club_id,
    });
    if (!ok) return json({ error: "Forbidden" }, 403);

    const now = new Date().toISOString();

    if (action === "approve") {
      const { error: e1 } = await admin
        .from("membership_verification_requests")
        .update({ status: "approved", reviewed_by: uid, reviewed_at: now })
        .eq("id", request_id);
      if (e1) return json({ error: e1.message }, 500);

      await admin
        .from("profiles")
        .update({
          verification_status: "verified",
          verified_by_club_id: reqRow.club_id,
          verified_at: now,
        })
        .eq("user_id", reqRow.player_user_id);

      await admin.from("notifications").insert({
        user_id: reqRow.player_user_id,
        type: "verification_approved",
        title: "Tài khoản đã được xác minh",
        body: "CLB đã duyệt yêu cầu xác minh thành viên của bạn.",
        data: { club_id: reqRow.club_id, request_id },
      });
    } else {
      const { error: e1 } = await admin
        .from("membership_verification_requests")
        .update({
          status: "rejected",
          reviewed_by: uid,
          reviewed_at: now,
          rejection_reason: rejection_reason,
        })
        .eq("id", request_id);
      if (e1) return json({ error: e1.message }, 500);

      await admin.from("notifications").insert({
        user_id: reqRow.player_user_id,
        type: "verification_rejected",
        title: "Yêu cầu xác minh bị từ chối",
        body: rejection_reason,
        data: { club_id: reqRow.club_id, request_id },
      });
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
