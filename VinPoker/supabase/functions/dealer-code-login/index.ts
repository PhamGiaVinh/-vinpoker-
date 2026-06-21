// dealer-code-login — exchange a one-time /code login code for a Supabase session token_hash.
//
// Pre-auth endpoint (the dealer isn't signed in yet): deployed WITHOUT verify_jwt. It trusts NO
// JWT — the ONLY credential is the one-time code (issued by the Telegram /code command, stored
// sha256-hashed + single-use + 10-min TTL in dealer_login_codes). On a valid code it mints a
// magic-link token_hash for the dealer's EXISTING auth user (set by /setup) and returns it; the
// app then calls supabase.auth.verifyOtp({ token_hash, type:'magiclink' }) — the same path
// AuthCallback already uses. No custom JWT / service-role session forging.
//
// Spec: docs/dealer-app/DEALER_LINK_CODE_LOGIN.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    // Normalize: uppercase + strip the cosmetic dash/spaces so "abcd-efgh" == "ABCDEFGH".
    const normalized = String((body as { code?: unknown })?.code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (normalized.length < 6) {
      return json({ error: "Mã không hợp lệ." }, 400);
    }

    const codeHash = await sha256Hex(normalized);
    const nowISO = new Date().toISOString();

    // Atomic single-use claim: only one caller can flip used=false → true while unexpired.
    const { data: claimed, error: claimErr } = await admin
      .from("dealer_login_codes")
      .update({ used: true })
      .eq("code_hash", codeHash)
      .eq("used", false)
      .gt("expires_at", nowISO)
      .select("user_id")
      .maybeSingle();

    if (claimErr || !claimed?.user_id) {
      return json({ error: "Mã không hợp lệ hoặc đã hết hạn." }, 400);
    }

    const { data: u, error: uErr } = await admin.auth.admin.getUserById(claimed.user_id as string);
    const email = u?.user?.email;
    if (uErr || !email) {
      return json({ error: "Tài khoản không khả dụng." }, 400);
    }

    // Mint a magic-link token for the dealer's existing auth user (no email sent by generateLink).
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error("[dealer-code-login] generateLink failed:", linkErr?.message);
      return json({ error: "Không tạo được phiên đăng nhập." }, 500);
    }

    return json({ token_hash: tokenHash, type: "magiclink" });
  } catch (e) {
    console.error("[dealer-code-login] error:", (e as Error).message);
    return json({ error: "Lỗi hệ thống." }, 500);
  }
});
