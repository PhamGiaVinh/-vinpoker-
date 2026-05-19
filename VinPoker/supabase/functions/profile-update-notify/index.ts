import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELD_LABELS: Record<string, string> = {
  bank_name: "Ngân hàng",
  bank_account_number: "Số tài khoản",
  bank_account_holder: "Chủ tài khoản",
  phone: "Số điện thoại",
  display_name: "Tên hiển thị",
  bio: "Giới thiệu",
  avatar_url: "Ảnh đại diện",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const record = body?.record;
    if (!record?.id || !record?.user_id) {
      return json({ error: "Invalid webhook payload: missing record" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user_id, club_id, changed_fields, old_values, new_values } = record as {
      user_id: string;
      club_id: string | null;
      changed_fields: string[];
      old_values: Record<string, unknown>;
      new_values: Record<string, unknown>;
    };

    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", user_id)
      .maybeSingle();
    const playerName = profile?.display_name ?? "Người dùng";

    const changedLabels = changed_fields
      .map((f: string) => FIELD_LABELS[f] ?? f)
      .join(", ");

    const title = "Cập nhật hồ sơ";
    const bodyText = `${playerName} đã cập nhật: ${changedLabels}.`;

    const recipients = new Set<string>();

    if (club_id) {
      const { data: cashiers } = await admin
        .from("club_cashiers")
        .select("user_id")
        .eq("club_id", club_id);
      if (cashiers) {
        for (const c of cashiers) recipients.add(c.user_id);
      }

      const { data: club } = await admin
        .from("clubs")
        .select("owner_id")
        .eq("id", club_id)
        .maybeSingle();
      if (club?.owner_id) recipients.add(club.owner_id);
    } else {
      const { data: superAdmins } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "super_admin");
      if (superAdmins) {
        for (const sa of superAdmins) recipients.add(sa.user_id);
      }
    }

    recipients.delete(user_id);

    if (recipients.size > 0) {
      const notificationRows = Array.from(recipients).map((uid) => ({
        user_id: uid,
        type: "profile_updated",
        title,
        body: bodyText,
        data: {
          updated_user_id: user_id,
          club_id,
          changed_fields,
          old_values,
          new_values,
        },
      }));

      const { error: notifErr } = await admin.from("notifications").insert(notificationRows);
      if (notifErr) console.error("Insert notifications error:", notifErr);

      for (const uid of recipients) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              user_id: uid,
              heading: title,
              message: bodyText,
            }),
          });
        } catch (_) {
          /* non-critical */
        }
      }
    }

    const changesSummary = changed_fields.map((f: string) => {
      const label = FIELD_LABELS[f] ?? f;
      const oldVal = formatValue(old_values[f]);
      const newVal = formatValue(new_values[f]);
      return `${label}: "${oldVal}" → "${newVal}"`;
    });

    return json({
      ok: true,
      recipient_count: recipients.size,
      changes: changesSummary,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "(trống)";
  return String(val);
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
