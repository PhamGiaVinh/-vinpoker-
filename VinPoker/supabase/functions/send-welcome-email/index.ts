// Sends a welcome email after first email verification.
// Idempotent: marks profiles.welcome_email_sent_at on success.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://vinpoker.live";
// Set to true once a domain is verified at resend.com/domains and FROM uses that domain.
const RESEND_DOMAIN_VERIFIED = false;
const SANDBOX_TEST_EMAIL = "zadvietnam2010@gmail.com";
const FROM = RESEND_DOMAIN_VERIFIED
  ? "VBacker <noreply@vinpoker.live>"
  : "VBacker <onboarding@resend.dev>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return j({ error: "RESEND_API_KEY missing" }, 500);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace("Bearer ", "");
    // Best-effort endpoint: silently skip when there is no valid session
    // (e.g. user just logged out, token expired). Returning 401 here would
    // surface as a runtime error in the client.
    if (!token) return j({ skipped: true, reason: "no_token" });

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: ures } = await userClient.auth.getUser();
    const user = ures?.user;
    if (!user?.email) return j({ skipped: true, reason: "no_user" });
    if (!user.email_confirmed_at) return j({ skipped: true, reason: "not_confirmed" });

    const admin = createClient(supabaseUrl, serviceKey);

    // Idempotency: skip if already sent
    const { data: prof } = await admin
      .from("profiles")
      .select("welcome_email_sent_at, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (prof?.welcome_email_sent_at) return j({ skipped: true });

    // Resend sandbox: only the verified test inbox can receive emails.
    // Skip silently for other recipients to avoid breaking signup flow.
    if (!RESEND_DOMAIN_VERIFIED && user.email.toLowerCase() !== SANDBOX_TEST_EMAIL) {
      return j({ skipped: true, reason: "resend_sandbox" });
    }

    const name = (prof?.display_name as string) || user.email.split("@")[0];
    const html = welcomeHtml({ name, email: user.email });

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],
        subject: "Chào mừng đến với VBacker Staking",
        html,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("Resend error", r.status, t);
      return j({ error: "send failed", details: t }, 502);
    }

    await admin
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("user_id", user.id);

    return j({ ok: true });
  } catch (e: any) {
    console.error(e);
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function welcomeHtml(opts: { name: string; email: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b0d12;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d12;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#11151c;border:1px solid #1f2632;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #1f2632;">
          <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:.3px;">VBacker <span style="color:#22c55e;">Staking</span></div>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;color:#fff;font-size:22px;">Chào mừng ${escapeHtml(opts.name)}! 🎉</h1>
          <p style="margin:0 0 14px;color:#c5cbd6;font-size:14px;line-height:1.6;">
            Cảm ơn bạn đã tham gia <b>VBacker</b> — nền tảng kết nối Player & Backer trong cộng đồng poker Việt Nam.
          </p>
          <p style="margin:0 0 14px;color:#c5cbd6;font-size:14px;line-height:1.6;">
            <b>Bước tiếp theo:</b>
          </p>
          <ul style="margin:0 0 16px 18px;padding:0;color:#c5cbd6;font-size:14px;line-height:1.7;">
            <li>Cập nhật hồ sơ và <b>tài khoản ngân hàng VND</b> trong mục Tài khoản để có thể nhận thanh toán.</li>
            <li>Khám phá các deal đang mở trong <b>Marketplace Staking</b>.</li>
            <li>Đọc kỹ <b>Điều khoản dịch vụ</b> trước khi tham gia deal đầu tiên.</li>
          </ul>
          <p style="margin:18px 0 0;text-align:center;">
            <a href="${APP_URL}/account" style="display:inline-block;background:#22c55e;color:#0b0d12;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">Hoàn thiện hồ sơ</a>
          </p>
          <p style="margin:24px 0 0;color:#9aa3b2;font-size:12px;line-height:1.6;">
            Cần hỗ trợ? Liên hệ Admin qua Zalo/Telegram được niêm yết trên nền tảng.
          </p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #1f2632;color:#6b7280;font-size:11px;text-align:center;">
          Email gửi tới ${escapeHtml(opts.email)}. © VBacker
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
