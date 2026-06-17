import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTelegramNotification, getClubTelegramChatId, mention } from "../_shared/telegram.ts";
import { startMealBreak } from "../_shared/mealBreakService.ts";

// Shared dealer state labels (VI) for status / check-in / check-out replies.
const STATE_LABELS: Record<string, string> = {
  available: "Sẵn sàng",
  assigned: "Đang bàn",
  on_break: "Đang nghỉ",
  pre_assigned: "Đang chờ phân bàn",
  in_transition: "Đang chuyển bàn",
  checked_out: "Đã check-out",
  swing_ready: "Sẵn sàng swing",
};

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

async function sendDM(botToken: string, chatId: number, text: string, parseMode: string | null = "Markdown") {
  const payload: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) payload.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Dealer web app base URL (magic-link redirect target). Default is the live
// Vercel deployment (vinpoker.live is not yet connected — apex DNS pending).
// When the custom domain is live, set the `APP_BASE_URL` edge secret to
// `https://vinpoker.live` — no code change. Owner must also allowlist
// `${APP_BASE_URL}/dealer` in Supabase Auth → URL configuration (for the
// one-tap magic link; the account-code + password login needs no allowlist).
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "https://vinpoker.vercel.app").replace(/\/+$/, "");
const DEALER_APP_URL = `${APP_BASE_URL}/dealer`;

// Cryptographically-random temporary password (ambiguity-free printable alphabet).
function randomPassword(len = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (!botToken) {
    console.error("[telegram-bot] TELEGRAM_BOT_TOKEN not set");
    return json({ error: "Bot token not configured" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const message = body?.message;
  if (!message?.text) return json({ ok: true });

  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = message.text.trim();
  const userId = message.from?.id;
  const username = message.from?.username ?? null;

  if (chatType !== "private") {
    await sendDM(botToken, chatId, "Vui lòng nhắn tin riêng (DM) với bot để sử dụng lệnh.");
    return json({ ok: true });
  }

  if (webhookSecret) {
    const receivedHash = req.headers.get("x-telegram-bot-api-secret-hash");
    if (!receivedHash || receivedHash !== webhookSecret) {
      return json({ error: "Unauthorized" }, 403);
    }
  }

  if (!userId) {
    return json({ ok: true });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auto-update telegram_username on every message
    if (username) {
      await admin
        .from("dealers")
        .update({ telegram_username: username })
        .eq("telegram_user_id", userId)
        .neq("telegram_username", username);
    }

    // Parse command (handle /cmd@botname and /start param)
    const cmdParts = text.split(/\s+/);
    const rawCmd = cmdParts[0].split("@")[0].toLowerCase();
    const cmdArgs = cmdParts.slice(1).join(" ").trim();

    // ── /start <param> (deep link) ──────────────────────────────────────
    if (rawCmd === "/start" && cmdArgs) {
      const dealerName = decodeURIComponent(cmdArgs);
      await handleSetup(admin, botToken, chatId, userId, username, dealerName);
      return json({ ok: true });
    }

    // ── /setup [Tên] — provision dealer-app account + send login ─────────
    // Floor-approval gate: the sender must already be telegram-linked OR have
    // been pre-entered by @username (Dealer Management → Telegram tab). A typed
    // name is an optional legacy fallback. No arg required.
    if (rawCmd === "/setup") {
      await handleSetup(admin, botToken, chatId, userId, username, cmdArgs);
      return json({ ok: true });
    }

    // ── /taotaikhoan [gmail] — create the dealer-app account (already linked) ─
    // For a dealer who is ALREADY telegram-linked but has no app account yet:
    // issues the account ONCE. Optional <gmail> binds a real email so they can
    // sign in + self-recover by email. Aliases for typing convenience.
    if (["/taotaikhoan", "/tao_tai_khoan", "/taotk", "/taikhoan", "/account"].includes(rawCmd)) {
      await handleCreateAccount(admin, botToken, chatId, userId, cmdArgs);
      return json({ ok: true });
    }

    // ── /unlink ──────────────────────────────────────────────────────────
    if (rawCmd === "/unlink") {
      await handleUnlink(admin, botToken, chatId, userId, false);
      return json({ ok: true });
    }

    // ── /unlink_yes (confirmation) ───────────────────────────────────────
    if (rawCmd === "/unlink_yes") {
      await handleUnlink(admin, botToken, chatId, userId, true);
      return json({ ok: true });
    }

    // ── Find linked dealer for remaining commands ────────────────────────
    const { data: dealer } = await admin
      .from("dealers")
      .select("id, club_id, full_name, telegram_username, telegram_user_id")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    if (!dealer) {
      if (username) {
        // Case-insensitive match on the operator-entered @username (Dealer
        // Management → Telegram tab) so a pre-registered dealer's FIRST message
        // auto-links their numeric id. Escape LIKE wildcards — `_` is valid in
        // Telegram usernames and would otherwise match the wrong dealer.
        const usernamePattern = username.replace(/([%_\\])/g, "\\$1");
        const { data: dealer2 } = await admin
          .from("dealers")
          .select("id, club_id, full_name, telegram_username, telegram_user_id")
          .ilike("telegram_username", usernamePattern)
          .maybeSingle();

        if (dealer2 && !dealer2.telegram_user_id) {
          await admin
            .from("dealers")
            .update({ telegram_user_id: userId, telegram_username: username })
            .eq("id", dealer2.id);
          await handleCommand(admin, botToken, chatId, text, { ...dealer2, telegram_user_id: userId }, userId);
          return json({ ok: true });
        }
      }

      await sendDM(botToken, chatId, "Bạn chưa liên kết Telegram với tài khoản dealer.\nDùng /setup <Tên> hoặc liên hệ DC.");
      return json({ ok: true });
    }

    await handleCommand(admin, botToken, chatId, text, dealer, userId);
  } catch (err) {
    console.error("[telegram-bot] Error:", err);
    await sendDM(botToken, chatId, "Lỗi hệ thống. Vui lòng thử lại sau.").catch(() => {});
  }

  return json({ ok: true });
});

// ── /setup handler ────────────────────────────────────────────────────────

async function handleSetup(
  admin: any,
  botToken: string,
  chatId: number,
  userId: number,
  username: string | null,
  nameHint: string,
) {
  const cols = "id, full_name, club_id, status, user_id, telegram_user_id, telegram_username";

  // 1. Resolve the dealer (floor-approval gate).
  let target: any = null;

  // (a) already telegram-linked by numeric id
  const byId = await admin.from("dealers").select(cols).eq("telegram_user_id", userId).maybeSingle();
  target = byId.data ?? null;

  // (b) floor pre-entered this @username (Dealer Management → Telegram tab)
  if (!target && username) {
    const pattern = username.replace(/([%_\\])/g, "\\$1");
    const byName = await admin.from("dealers").select(cols).ilike("telegram_username", pattern).maybeSingle();
    if (byName.data && (!byName.data.telegram_user_id || byName.data.telegram_user_id === userId)) {
      target = byName.data;
    }
  }

  // (c) optional legacy typed-name fallback (/setup <name> / deep link)
  if (!target && nameHint) {
    const { data: candidates } = await admin.from("dealers").select(cols).ilike("full_name", nameHint).limit(5);
    if (candidates && candidates.length > 1) {
      await sendDM(botToken, chatId, `Tìm thấy nhiều người cùng tên "${nameHint}". Vui lòng liên hệ DC.`);
      return;
    }
    if (candidates && candidates.length === 1 && !candidates[0].telegram_user_id) target = candidates[0];
  }

  if (!target) {
    if (!username) {
      await sendDM(
        botToken,
        chatId,
        "Tài khoản Telegram của bạn chưa đặt @username công khai.\nVào Cài đặt Telegram → Username để đặt, rồi gõ /setup lại.\n(Hoặc nhờ DC xác minh và nhập tên bạn.)",
      );
    } else {
      await sendDM(
        botToken,
        chatId,
        "Chưa thấy bạn trong danh sách dealer.\nNhờ Floor/DC xác minh và nhập @username Telegram của bạn (Quản lý dealer → Telegram), rồi gõ /setup lại.",
      );
    }
    return;
  }

  // Guard: the telegram link must belong to this sender.
  if (target.telegram_user_id && target.telegram_user_id !== userId) {
    await sendDM(botToken, chatId, `"${target.full_name}" đã được liên kết với tài khoản Telegram khác.\nVui lòng liên hệ DC.`);
    return;
  }

  // Claim the telegram link if not yet set (floor approval → this sender).
  if (!target.telegram_user_id) {
    await admin.from("dealers").update({ telegram_user_id: userId, telegram_username: username }).eq("id", target.id);
  }

  // 2. Provision (or reuse) the dealer-app account + send login over Telegram.
  await provisionDealerAccount(admin, botToken, chatId, userId, target);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ── /taotaikhoan handler — create the dealer-app account on demand ──────────
// Precondition: the sender is ALREADY telegram-linked (a dealer row carries their
// telegram_user_id). Without a real-email arg, the account is issued ONCE; once it
// exists the command will NOT silently re-issue — the dealer recovers via email or
// gets a Gmail bound. With a <gmail> arg, a real email is set (create or bind) so
// the dealer can sign in + reset by email "như bình thường".
async function handleCreateAccount(
  admin: any,
  botToken: string,
  chatId: number,
  userId: number,
  emailArg: string,
) {
  const cols = "id, full_name, club_id, status, user_id, telegram_user_id, telegram_username";
  const { data: target } = await admin.from("dealers").select(cols).eq("telegram_user_id", userId).maybeSingle();

  if (!target) {
    await sendDM(
      botToken,
      chatId,
      "Bạn chưa liên kết Telegram với hồ sơ dealer.\nGõ /setup trước (hoặc nhờ Floor/DC nhập @username của bạn), rồi gõ /taotaikhoan lại.",
    );
    return;
  }

  const email = emailArg.trim();
  if (email && !isEmail(email)) {
    await sendDM(botToken, chatId, "Email không hợp lệ. Ví dụ: /taotaikhoan ten@gmail.com");
    return;
  }

  // Already has an account + no new email → enforce "cấp 1 lần"; point to recovery.
  if (target.user_id && !email) {
    await sendDM(
      botToken,
      chatId,
      "Bạn đã có tài khoản dealer (chỉ cấp 1 lần).\nNếu quên mật khẩu:\n• Gõ /taotaikhoan <gmail của bạn> để gắn Gmail và tự đặt lại mật khẩu, hoặc\n• Liên hệ DC để được cấp lại.",
    );
    return;
  }

  // Create (no account) OR bind a real email to the existing account.
  await provisionDealerAccount(admin, botToken, chatId, userId, target, email || null);
}

/** Mask an email for logs/replies — keep first char + domain (n***@gmail.com). */
function maskEmail(e: string | null): string {
  if (!e) return "none";
  const [local, domain] = e.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

const DEALER_SYNTH_SUFFIX = "@dealer.vinpoker.live";

// ── Provision / recover a VBacker account for a (floor-approved) dealer ─────
// Guards (hardened before deploy):
//  • A temp PASSWORD is issued ONLY when a brand-new code account is created, and
//    sent to the dealer ONCE. Existing accounts are NEVER re-passworded here
//    (recovery = one-tap link + email reset).
//  • A real email (Gmail) is bound ONLY when the current email is synthetic/absent;
//    an already-set real email is NEVER overwritten via the bot.
//  • A real email already used by ANOTHER account is refused (no account adoption /
//    takeover) — only the synthetic (own-tgid) email may recover an existing row.
//  • Never logs password / magic link / full email. Audit = masked, structured.
// Owner must allowlist DEALER_APP_URL as a magic-link redirect. No swing/payroll.
async function provisionDealerAccount(
  admin: any,
  botToken: string,
  chatId: number,
  userId: number,
  target: any,
  explicitEmail: string | null = null,
) {
  let authUserId: string | null = target.user_id ?? null;
  let email: string | null = null;
  let tempPassword: string | null = null; // set ONLY for a freshly created account
  let oldEmail: string | null = null;
  let action = "";

  const audit = (act: string, newE: string | null) =>
    console.log(JSON.stringify({
      evt: "dealer_account",
      action: act,
      telegram_id: userId,
      dealer_id: target.id,
      old_email: maskEmail(oldEmail),
      new_email: maskEmail(newE),
      ts: new Date().toISOString(),
    }));

  if (authUserId) {
    // Existing account — never reissue the password here.
    const { data: u } = await admin.auth.admin.getUserById(authUserId);
    const current: string | null = u?.user?.email ?? null;
    oldEmail = current;
    const currentIsSynthetic = !current || current.endsWith(DEALER_SYNTH_SUFFIX);

    if (explicitEmail) {
      if (!currentIsSynthetic) {
        // Guard: a real email is already set — do NOT overwrite it via the bot.
        await sendDM(
          botToken,
          chatId,
          `Tài khoản của bạn đã gắn email thật (${maskEmail(current)}).\nBot không đổi email. Dùng "Quên mật khẩu" qua email đó, hoặc liên hệ quản lý.`,
        );
        audit("bind_email_refused_existing_real", explicitEmail);
        return;
      }
      // Bind the real email so the dealer can sign in + self-recover by email.
      const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, {
        email: explicitEmail,
        email_confirm: true,
      });
      if (updErr) {
        await sendDM(
          botToken,
          chatId,
          `Không gắn được Gmail (${maskEmail(explicitEmail)}) — có thể đã dùng cho tài khoản khác.\nDùng email khác, hoặc liên hệ quản lý.`,
        );
        audit("bind_email_refused_taken", explicitEmail);
        return;
      }
      email = explicitEmail;
      action = "bind_email";
    } else {
      email = current;
      action = "resend_link";
    }
  } else {
    // New account.
    email = explicitEmail ?? `dlr${userId.toString(36)}${DEALER_SYNTH_SUFFIX}`;
    tempPassword = randomPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name: target.full_name, dealer_id: target.id, source: "telegram_account" },
    });
    if (createErr) {
      if (explicitEmail) {
        // A REAL email collided with an existing account → refuse (no takeover).
        await sendDM(
          botToken,
          chatId,
          `Email "${maskEmail(email)}" đã được dùng cho một tài khoản khác.\nDùng email khác, hoặc liên hệ quản lý.`,
        );
        audit("create_email_refused_taken", email);
        return;
      }
      // Synthetic (own-tgid) collision = this dealer's prior partial run → safe
      // recover. Do NOT reset the password.
      const { data: link0 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      authUserId = link0?.user?.id ?? null;
      tempPassword = null;
      action = "recover_existing";
    } else {
      authUserId = created?.user?.id ?? null;
      action = "create";
    }
    if (authUserId) await admin.from("dealers").update({ user_id: authUserId }).eq("id", target.id);
  }

  if (!authUserId || !email) {
    await sendDM(botToken, chatId, "Không tạo được tài khoản. Vui lòng liên hệ DC/kỹ thuật.");
    audit("provision_failed", email);
    return;
  }

  // One-tap magic link (logs in, then redirects into the dealer app).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: DEALER_APP_URL },
  });
  const actionLink: string | null = linkData?.properties?.action_link ?? null;

  const isSynthetic = email.endsWith(DEALER_SYNTH_SUFFIX);
  const accountCode = email.split("@")[0];

  // Reply in plain text so the long URL isn't mangled by Markdown.
  const lines = [
    `✅ Tài khoản dealer của "${target.full_name}" đã sẵn sàng — bạn đã được duyệt.`,
    "",
    `Mở app: ${DEALER_APP_URL}`,
  ];
  if (actionLink) {
    lines.push("", "Đăng nhập 1 chạm (bấm là vào thẳng app, hết hạn sau ~1 giờ):", actionLink);
  }

  if (isSynthetic) {
    lines.push("", "Đăng nhập (mục Đăng nhập dealer trong app):", `• Mã tài khoản: ${accountCode}`);
    if (tempPassword) {
      lines.push(
        `• Mật khẩu tạm: ${tempPassword}`,
        "",
        "⚠️ Thông tin này CHỈ được cấp 1 lần — hãy lưu lại.",
        "Mất mật khẩu? Gõ /taotaikhoan <gmail của bạn> để gắn Gmail và tự khôi phục, hoặc liên hệ quản lý.",
      );
    } else {
      lines.push(
        "",
        "Tài khoản đã tồn tại — bot KHÔNG cấp lại mật khẩu.",
        "Dùng link 1 chạm ở trên, hoặc gắn Gmail bằng /taotaikhoan <gmail>, hoặc liên hệ quản lý.",
      );
    }
  } else {
    lines.push(
      "",
      `Tài khoản dùng Gmail: ${maskEmail(email)}`,
      "Từ giờ đăng nhập bằng Gmail này; quên mật khẩu thì dùng 'Quên mật khẩu' qua Gmail như bình thường.",
    );
  }
  if (!actionLink && linkErr) {
    lines.push("", "(Chưa tạo được link 1 chạm — dùng cách đăng nhập ở trên.)");
  }
  await sendDM(botToken, chatId, lines.join("\n"), null);

  audit(action, email);
}

// ── /unlink handler ───────────────────────────────────────────────────────

async function handleUnlink(
  admin: any,
  botToken: string,
  chatId: number,
  userId: number,
  confirmed: boolean,
) {
  const { data: dealer } = await admin
    .from("dealers")
    .select("id, full_name")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (!dealer) {
    await sendDM(botToken, chatId, "Bạn chưa liên kết tài khoản nào.");
    return;
  }

  if (!confirmed) {
    await sendDM(botToken, chatId, `Bạn có chắc muốn hủy liên kết với "${dealer.full_name}"?\nGõ /unlink_yes để xác nhận.`);
    return;
  }

  await admin
    .from("dealers")
    .update({ telegram_user_id: null, telegram_username: null })
    .eq("id", dealer.id);

  await sendDM(botToken, chatId, `✅ Đã hủy liên kết với "${dealer.full_name}".\nDùng /setup <Tên> để liên kết lại.`);
}

// Format an ISO timestamp as HH:MM in club-local (Vietnam) time for replies.
function fmtHm(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("vi-VN", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh",
    });
  } catch {
    return "";
  }
}

// ── /checkin (scheduled-pool path) — canonical RPC, no direct insert ───────────
// Routes through dealer_self_checkin_by_telegram so app + Telegram share ONE rule:
// arrival is recorded, but pool entry (and payroll clock) starts at the scheduled
// shift time. Early arrival → pending (cron enters at scheduled start); on-time/late
// → entered now. The RPC NEVER lets the bot insert dealer_attendance directly.
async function handleCheckinScheduled(
  admin: any,
  botToken: string,
  chatId: number,
  dealer: { id: string; club_id: string; full_name: string },
  telegramUserId: number,
) {
  const { data, error } = await admin.rpc("dealer_self_checkin_by_telegram", {
    p_telegram_user_id: telegramUserId,
  });
  if (error) {
    console.error("[telegram-bot] scheduled checkin rpc error:", error.message);
    await sendDM(botToken, chatId, "❌ Check-in thất bại. Vui lòng thử lại hoặc báo DC.");
    return;
  }
  const outcome = (data as any)?.outcome as string | undefined;
  if (outcome === "no_assignment") {
    await sendDM(botToken, chatId, `ℹ️ *${dealer.full_name}* chưa có lịch hôm nay.\nVui lòng báo DC xếp lịch trước khi check-in.`);
    return;
  }
  if (outcome === "no_dealer" || outcome === "not_authorized") {
    await sendDM(botToken, chatId, "❌ Không xác định được tài khoản dealer. Báo DC kiểm tra liên kết.");
    return;
  }
  if (outcome === "too_early") {
    await sendDM(botToken, chatId, `⏳ Chưa tới giờ check-in. Cửa sổ mở lúc *${fmtHm((data as any).window_opens_at)}*.`);
    return;
  }
  if (outcome === "invalid_state") {
    await sendDM(botToken, chatId, "ℹ️ Trạng thái ca đã thay đổi. Báo DC nếu cần.");
    return;
  }
  if (outcome !== "checked_in") {
    await sendDM(botToken, chatId, "❌ Không tìm thấy ca. Vui lòng báo DC.");
    return;
  }
  if ((data as any).pending_pool) {
    await sendDM(botToken, chatId,
      `✅ *${dealer.full_name}* — đã ghi nhận có mặt.\n⏳ Bạn sẽ *vào pool* lúc *${fmtHm((data as any).pool_entry_at)}* (đúng giờ ca). DC sẽ phân bàn từ lúc đó.`);
  } else if ((data as any).entered_pool) {
    await sendDM(botToken, chatId,
      `✅ *${dealer.full_name}* đã check-in và *đã vào pool* xoay dealer — DC sẽ phân bàn cho bạn.`);
  } else if ((data as any).pool_entry_reason === "already_in_pool") {
    await sendDM(botToken, chatId, `✅ *${dealer.full_name}* đã có trong pool, không tạo check-in trùng.`);
  } else {
    await sendDM(botToken, chatId, `✅ *${dealer.full_name}* đã check-in.`);
  }
}

// ── /checkin — real check-in → into the available pool ─────────────────────
// Mirrors doCheckin in DealerSwingTab.tsx: INSERT a fresh dealer_attendance row
// (status='checked_in', current_state='available'). Idempotent: if the dealer
// already has an active checked-in row, report status instead of duplicating.
async function handleCheckin(
  admin: any,
  botToken: string,
  chatId: number,
  dealer: { id: string; club_id: string; full_name: string },
  telegramUserId: number,
) {
  // Server-side kill-switch: when scheduled-pool is enabled, all self check-in
  // channels share the canonical RPC (arrival ≠ pool entry; pool/payroll starts at
  // the scheduled shift time). While disabled, keep the legacy immediate behavior.
  const { data: cfg } = await admin
    .from("dealer_selfcheckin_config")
    .select("scheduled_pool_enabled")
    .maybeSingle();
  if (cfg?.scheduled_pool_enabled) {
    await handleCheckinScheduled(admin, botToken, chatId, dealer, telegramUserId);
    return;
  }

  // ── Legacy path (unchanged): immediate direct insert into the available pool ──
  // Today's shift_date (UTC date), matching DealerSwingTab.doCheckin so the bot
  // and operator UI share the same idempotency key + unique-index scope. A stale
  // checked_in row from a PREVIOUS day must NOT short-circuit today's check-in.
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await admin
    .from("dealer_attendance")
    .select("id, current_state, status")
    .eq("dealer_id", dealer.id)
    .eq("shift_date", today)
    .eq("status", "checked_in")
    .order("check_in_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const label = STATE_LABELS[existing.current_state] ?? existing.current_state;
    await sendDM(
      botToken,
      chatId,
      `✅ *${dealer.full_name}* đã check-in rồi.\nTrạng thái: *${label}*` +
        (existing.current_state === "available"
          ? "\n\n🟢 Bạn đang trong pool sẵn sàng — chờ DC phân bàn."
          : ""),
    );
    return;
  }

  // Resolve the club's first tour/shift (same basis as the operator check-in UI).
  const { data: shifts } = await admin
    .from("dealer_shifts")
    .select("id")
    .eq("club_id", dealer.club_id)
    .order("start_time")
    .limit(1);
  const shiftId = (shifts ?? [])[0]?.id ?? null;

  // Partial unique index idx_one_active_checkin_per_dealer guards double active
  // check-in (dealer_id, shift_date WHERE status='checked_in').
  const { error } = await admin.from("dealer_attendance").insert({
    dealer_id: dealer.id,
    shift_id: shiftId,
    shift_date: today,
    status: "checked_in",
    current_state: "available",
    check_in_time: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      await sendDM(botToken, chatId, `✅ *${dealer.full_name}* đã ở trong pool sẵn sàng.`);
      return;
    }
    console.error("[telegram-bot] checkin insert error:", error.message);
    await sendDM(botToken, chatId, "❌ Check-in thất bại. Vui lòng thử lại hoặc báo DC.");
    return;
  }

  await sendDM(
    botToken,
    chatId,
    `✅ *${dealer.full_name}* đã check-in!\n🟢 Bạn đã vào *pool sẵn sàng* — DC sẽ phân bàn cho bạn.\n\nKết thúc ca: báo DC để được check-out.`,
  );
}

// ── /status — read-only current state ──────────────────────────────────────
async function handleStatus(
  admin: any,
  botToken: string,
  chatId: number,
  dealer: { id: string; full_name: string },
) {
  const { data: att } = await admin
    .from("dealer_attendance")
    .select("current_state, status")
    .eq("dealer_id", dealer.id)
    .eq("status", "checked_in")
    .order("check_in_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!att) {
    await sendDM(botToken, chatId, `❌ *${dealer.full_name}* chưa check-in.\nGõ /checkin để vào ca.`);
    return;
  }

  const label = STATE_LABELS[att.current_state] ?? att.current_state;
  await sendDM(botToken, chatId, `✅ *${dealer.full_name}*\nTrạng thái: *${label}*`);
}

// ── /checkout — self check-out (DISABLED — NO LONGER WIRED) ─────────────────
// Owner 2026-06-16: dealer self-checkout removed; only dealer-control (DC) may
// check a dealer out, via the Dealer Swing operator panel. The /checkout command
// now returns a "báo DC" message (see handleCommand) and never calls this. Kept
// here for reference/history only — do not re-wire without owner approval.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleCheckout(
  admin: any,
  botToken: string,
  chatId: number,
  dealer: { id: string; club_id: string; full_name: string; telegram_username?: string | null; telegram_user_id?: number | null },
) {
  const { data: att } = await admin
    .from("dealer_attendance")
    .select("id, current_state, status, check_in_time")
    .eq("dealer_id", dealer.id)
    .eq("status", "checked_in")
    .order("check_in_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!att) {
    await sendDM(botToken, chatId, `ℹ️ *${dealer.full_name}* chưa check-in (hoặc đã check-out).`);
    return;
  }

  // Self-checkout is allowed ONLY from the idle pool (available). Any other
  // state involves a live table, a pending swing, or an open break that the
  // bot must not unwind on its own (e.g. on_break leaves an active meal-break
  // row the cron can't close once checked_out) → defer to DC / break ending.
  if (att.current_state !== "available") {
    if (att.current_state === "on_break") {
      await sendDM(
        botToken,
        chatId,
        `⚠️ Bạn đang *nghỉ*. Chờ hết giờ nghỉ (tự về pool) rồi /checkout, hoặc báo DC.`,
      );
    } else {
      const where = STATE_LABELS[att.current_state] ?? att.current_state;
      await sendDM(
        botToken,
        chatId,
        `⚠️ Bạn đang *${where}*. Vui lòng báo DC để swing ra khỏi bàn trước, rồi /checkout.`,
      );
    }
    return;
  }

  // ── Worked / overtime minutes (mirror checkout-dealer: 480-min shift,
  // subtract COMPLETED breaks only — open breaks are excluded, same as the
  // canonical operator path, so payroll minutes match between the two) ──
  const STANDARD_SHIFT_MINUTES = 480;
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let totalHours = 0;
  const checkInTime: string | null = att.check_in_time;

  if (checkInTime) {
    const totalMinutes = Math.round((Date.now() - new Date(checkInTime).getTime()) / 60000);

    const { data: assignments } = await admin
      .from("dealer_assignments")
      .select("id")
      .eq("attendance_id", att.id);
    const assignmentIds = (assignments ?? []).map((a: any) => a.id);

    const breakRows: Array<{ id: string; break_start: string; break_end: string | null }> = [];
    const { data: attBreaks } = await admin
      .from("dealer_breaks")
      .select("id, break_start, break_end")
      .eq("attendance_id", att.id)
      .not("break_end", "is", null);
    breakRows.push(...((attBreaks ?? []) as any[]));
    if (assignmentIds.length) {
      const { data: assBreaks } = await admin
        .from("dealer_breaks")
        .select("id, break_start, break_end")
        .in("assignment_id", assignmentIds)
        .not("break_end", "is", null);
      breakRows.push(...((assBreaks ?? []) as any[]));
    }

    const byId = new Map<string, { break_start: string; break_end: string | null }>();
    for (const b of breakRows) byId.set(b.id, { break_start: b.break_start, break_end: b.break_end });
    const breakMinutes = [...byId.values()].reduce((sum, b) => {
      const end = b.break_end ? new Date(b.break_end).getTime() : Date.now();
      return sum + Math.max(0, Math.round((end - new Date(b.break_start).getTime()) / 60000));
    }, 0);

    workedMinutes = totalMinutes - breakMinutes;
    overtimeMinutes = Math.max(0, workedMinutes - STANDARD_SHIFT_MINUTES);
    totalHours = Math.round(workedMinutes / 6) / 10;
  }

  // State transition (validated + audited inside the RPC), then checkout fields.
  // Capture the error channel too: supabase-js .rpc() returns {data:null,error}
  // on a DB-level failure (lock/timeout/permission) WITHOUT throwing, so a null
  // result must abort — otherwise we'd flip status='checked_out' while
  // current_state was never transitioned (status/current_state desync).
  const { data: txResult, error: txErr } = await admin.rpc("transition_dealer_state", {
    p_attendance_id: att.id,
    p_new_state: "checked_out",
    p_reason: "dealer_self_checkout_telegram",
  });
  if (txErr || !txResult || txResult.ok === false) {
    console.error("[telegram-bot] checkout transition failed:", txErr?.message ?? txResult?.error);
    await sendDM(botToken, chatId, "❌ Check-out thất bại (trạng thái không hợp lệ). Vui lòng báo DC.");
    return;
  }

  const nowISO = new Date().toISOString();
  const { error: coErr } = await admin
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
    .eq("id", att.id)
    .eq("status", "checked_in"); // anti-double-checkout guard

  if (coErr) {
    console.error("[telegram-bot] checkout update error:", coErr.message);
    await sendDM(botToken, chatId, "❌ Check-out thất bại. Vui lòng thử lại hoặc báo DC.");
    return;
  }

  // Release any dangling active assignment for this attendance (mirror
  // checkout-dealer step 5) so a now-checked-out dealer doesn't leave a table
  // counted as "occupied" by fillEmptyTables. needs_replacement lets the
  // scheduler prioritise refilling it. (available dealers normally have none.)
  try {
    // Release ALL active assignments (assigned/on_break/pre_assigned), not just
    // 'assigned' and not just the first row — an unreleased on_break/pre_assigned
    // row orphans the dealer and can freeze rotation (pickNextDealer Step 5b
    // matches by dealer_id). Mirror of checkout-dealer step 5.
    await admin
      .from("dealer_assignments")
      .update({ released_at: nowISO, status: "completed", needs_replacement: true })
      .eq("attendance_id", att.id)
      .in("status", ["assigned", "on_break", "pre_assigned"])
      .is("released_at", null);
  } catch { /* non-critical */ }

  // Best-effort audit (never block the checkout reply).
  try {
    await admin.from("audit_logs").insert({
      club_id: dealer.club_id,
      actor_id: null,
      action: "checkout_dealer",
      entity_type: "dealer_attendance",
      entity_id: att.id,
      payload: {
        dealer_name: dealer.full_name,
        source: "telegram_self_checkout",
        total_worked_minutes: workedMinutes,
        overtime_minutes: overtimeMinutes,
      },
    });
  } catch { /* non-critical */ }

  // Group-chat notify (mirror checkout-dealer message format).
  try {
    const groupChatId = await getClubTelegramChatId(admin, dealer.club_id);
    if (groupChatId) {
      const fmt = (d: Date) =>
        d.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Ho_Chi_Minh",
        });
      const inStr = checkInTime ? fmt(new Date(checkInTime)) : "?";
      const dealerMention = mention({
        full_name: dealer.full_name,
        telegram_username: dealer.telegram_username ?? null,
        telegram_user_id: dealer.telegram_user_id ? Number(dealer.telegram_user_id) : null,
      });
      await sendTelegramNotification(
        botToken,
        groupChatId,
        `${dealerMention} check out - thời gian làm việc ${inStr}-${fmt(new Date(nowISO))}: ${totalHours} tiếng`,
      ).catch(() => {});
    }
  } catch { /* non-critical */ }

  await sendDM(
    botToken,
    chatId,
    `👋 *${dealer.full_name}* đã check-out.\n⏱ Thời gian làm: *${totalHours} tiếng*` +
      (overtimeMinutes > 0 ? ` (OT ${overtimeMinutes}p)` : "") +
      `\n\nHẹn gặp lại! Gõ /checkin khi vào ca mới.`,
  );
}

// ── Existing commands ──────────────────────────────────────────────────────

async function handleCommand(
  admin: any,
  botToken: string,
  chatId: number,
  text: string,
  dealer: { id: string; club_id: string; full_name: string; telegram_username?: string | null; telegram_user_id?: number | null },
  userId: number,
) {
  const normalizedText = text.toLowerCase().trim();

  if (normalizedText === "/start" || normalizedText === "/help" || normalizedText === "help") {
    await sendDM(
      botToken,
      chatId,
      `🤖 *VinPoker Dealer Bot*\n\n` +
        `Lệnh:\n` +
        `• /setup <Tên> — Liên kết tài khoản\n` +
        `• /checkin — Vào ca (vào pool sẵn sàng)\n` +
        `• /status — Xem trạng thái hiện tại\n` +
        `• /break — Nghỉ ăn cơm (1 lần/7 tiếng, +15p bonus)\n` +
        `• /unlink — Hủy liên kết Telegram\n\n` +
        `💡 /checkin xong là bạn vào pool, DC sẽ phân bàn. Kết thúc ca do DC check-out. Nghỉ ăn cơm: 1 lần/7 tiếng.`,
    );
    return;
  }

  if (normalizedText === "/checkin" || normalizedText === "checkin") {
    await handleCheckin(admin, botToken, chatId, dealer, userId);
    return;
  }

  if (normalizedText === "/checkout" || normalizedText === "checkout") {
    // Dealer self-checkout DISABLED (owner 2026-06-16: chỉ dealer-control mới được
    // check-out). Check-out is done by floor/operator (DC) on the Dealer Swing panel.
    await sendDM(
      botToken,
      chatId,
      `ℹ️ Lệnh /checkout đã ngừng.\n\nViệc *check-out* do quản lý sàn (DC) thực hiện trên hệ thống. Khi kết thúc ca, bạn *báo DC* để được check-out.`,
    );
    return;
  }

  if (
    normalizedText === "/status" ||
    normalizedText === "status" ||
    normalizedText === "/trangthai"
  ) {
    await handleStatus(admin, botToken, chatId, dealer);
    return;
  }

  if (
    normalizedText === "/break" || normalizedText === "/an_com" ||
    normalizedText === "ăn cơm" || normalizedText === "an com"
  ) {
    const { data: att } = await admin
      .from("dealer_attendance")
      .select("id, current_state, status")
      .eq("dealer_id", dealer.id)
      .eq("status", "checked_in")
      .maybeSingle();

    if (!att) {
      await sendDM(botToken, chatId, "❌ Bạn chưa check-in. Vui lòng check-in trước.");
      return;
    }

    if (att.current_state !== "available") {
      const stateLabels: Record<string, string> = {
        assigned: "đang bàn",
        on_break: "đang nghỉ",
        pre_assigned: "đang chờ",
        in_transition: "đang chuyển bàn",
      };
      await sendDM(
        botToken,
        chatId,
        `❌ Bạn đang ${stateLabels[att.current_state] ?? att.current_state}. Chỉ có thể nghỉ ăn cơm khi sẵn sàng.`,
      );
      return;
    }

    const result = await startMealBreak(admin, att.id, dealer.club_id, dealer.id);

    if (result.ok) {
      await sendDM(
        botToken,
        chatId,
        `🍚 Đã đăng ký nghỉ ăn cơm!\n` +
          `⏱ ${result.totalDuration}p (${result.baseDuration}p + ${result.bonusMinutes}p bonus)\n` +
          `🔄 Tự động trở lại pool khi hết giờ.`,
      );
    } else {
      await sendDM(botToken, chatId, `❌ ${result.error}`);
    }
    return;
  }

  await sendDM(botToken, chatId, "Lệnh không xác định. Gõ /help để xem lệnh.");
}
