import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTelegramNotification } from "../_shared/telegram.ts";
import { startMealBreak } from "../_shared/mealBreakService.ts";

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

async function sendDM(botToken: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
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

    // ── /setup <exact name> ──────────────────────────────────────────────
    if (rawCmd === "/setup") {
      if (!cmdArgs) {
        await sendDM(botToken, chatId, "Cách dùng: /setup <Tên chính xác>\nVí dụ: /setup Nguyễn Văn A");
        return json({ ok: true });
      }
      await handleSetup(admin, botToken, chatId, userId, username, cmdArgs);
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
      .select("id, club_id, full_name, telegram_user_id")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    if (!dealer) {
      if (username) {
        const { data: dealer2 } = await admin
          .from("dealers")
          .select("id, club_id, full_name, telegram_user_id")
          .eq("telegram_username", username)
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
  dealerName: string,
) {
  // 1. Check if already linked
  const { data: existing } = await admin
    .from("dealers")
    .select("id, full_name")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (existing) {
    await sendDM(botToken, chatId, `Đã liên kết với "${existing.full_name}".\nDùng /unlink để hủy trước khi liên kết mới.`);
    return;
  }

  // 2. Find dealer (case-insensitive exact match)
  const { data: candidates } = await admin
    .from("dealers")
    .select("id, full_name, club_id, telegram_user_id")
    .ilike("full_name", dealerName)
    .limit(5);

  if (!candidates || candidates.length === 0) {
    await sendDM(botToken, chatId, `Không tìm thấy dealer "${dealerName}". Kiểm tra chính tả hoặc liên hệ DC.`);
    return;
  }

  if (candidates.length > 1) {
    const list = candidates.map((c: any, i: number) =>
      `${i + 1}. ${c.full_name} (ID: ${String(c.id).slice(0, 8)})`
    ).join("\n");
    await sendDM(botToken, chatId, `Tìm thấy nhiều người cùng tên:\n${list}\nVui lòng liên hệ DC để hỗ trợ.`);
    return;
  }

  const target = candidates[0];

  if (target.telegram_user_id) {
    await sendDM(botToken, chatId, `"${target.full_name}" đã được liên kết với tài khoản Telegram khác.\nVui lòng liên hệ DC.`);
    return;
  }

  // 3. Verify checked-in today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: att } = await admin
    .from("dealer_attendance")
    .select("id")
    .eq("dealer_id", target.id)
    .eq("status", "checked_in")
    .gte("created_at", today.toISOString())
    .maybeSingle();

  if (!att) {
    await sendDM(botToken, chatId, `⚠️ "${target.full_name}" chưa check-in hôm nay. Vui lòng check-in trước khi setup.`);
    return;
  }

  // 4. Link
  await admin
    .from("dealers")
    .update({ telegram_user_id: userId, telegram_username: username })
    .eq("id", target.id);

  await sendDM(botToken, chatId, `✅ Đã liên kết ${username ? `@${username}` : "tài khoản"} với "${target.full_name}".\n\nLệnh:\n• /checkin — Trạng thái\n• /an_com — Nghỉ ăn cơm\n• /unlink — Hủy liên kết`);
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

// ── Existing commands ──────────────────────────────────────────────────────

async function handleCommand(
  admin: any,
  botToken: string,
  chatId: number,
  text: string,
  dealer: { id: string; club_id: string; full_name: string; telegram_user_id?: number | null },
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
        `• /checkin — Kiểm tra trạng thái\n` +
        `• /an_com — Đăng ký nghỉ ăn cơm (+15p bonus)\n` +
        `• /unlink — Hủy liên kết Telegram\n\n` +
        `💡 Nghỉ ăn cơm: 1 lần/7 tiếng. Thời gian nghỉ linh hoạt theo tỉ lệ bàn/dealer.`,
    );
    return;
  }

  if (normalizedText === "/checkin" || normalizedText === "checkin") {
    const { data: att } = await admin
      .from("dealer_attendance")
      .select("id, current_state, status, last_meal_break_at")
      .eq("dealer_id", dealer.id)
      .eq("status", "checked_in")
      .maybeSingle();

    if (!att) {
      await sendDM(botToken, chatId, `❌ ${dealer.full_name} chưa check-in. Vui lòng check-in trước.`);
      return;
    }

    const stateLabels: Record<string, string> = {
      available: "Sẵn sàng",
      assigned: "Đang bàn",
      on_break: "Đang nghỉ",
      pre_assigned: "Đang chờ",
      in_transition: "Đang chuyển bàn",
      swing_ready: "Sẵn sàng swing",
    };

    await sendDM(
      botToken,
      chatId,
      `✅ *${dealer.full_name}*\nTrạng thái: ${stateLabels[att.current_state] ?? att.current_state}`,
    );
    return;
  }

  if (normalizedText === "/an_com" || normalizedText === "ăn cơm" || normalizedText === "an com") {
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
