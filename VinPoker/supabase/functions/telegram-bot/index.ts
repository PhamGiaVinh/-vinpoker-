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
  const username = message.from?.username;

  // Only allow private chats (DMs)
  if (chatType !== "private") {
    await sendDM(botToken, chatId, "Vui lòng nhắn tin riêng (DM) với bot để sử dụng lệnh.");
    return json({ ok: true });
  }

  // Verify webhook secret if configured
  if (webhookSecret) {
    const receivedHash = req.headers.get("x-telegram-bot-api-secret-hash");
    // Simple secret comparison (upgrade to HMAC in production)
    if (!receivedHash || receivedHash !== webhookSecret) {
      return json({ error: "Unauthorized" }, 403);
    }
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find dealer by telegram_user_id
    const { data: dealer } = await admin
      .from("dealers")
      .select("id, club_id, full_name, telegram_user_id")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    if (!dealer) {
      // Fallback: try telegram_username
      if (username) {
        const { data: dealer2 } = await admin
          .from("dealers")
          .select("id, club_id, full_name, telegram_user_id")
          .eq("telegram_username", username)
          .maybeSingle();

        if (dealer2) {
          // Link telegram_user_id for future lookups
          await admin
            .from("dealers")
            .update({ telegram_user_id: userId })
            .eq("id", dealer2.id);

          // Proceed with this dealer
          await handleCommand(admin, botToken, chatId, text, dealer2, userId);
          return json({ ok: true });
        }
      }

      await sendDM(botToken, chatId, "Bạn chưa liên kết Telegram với tài khoản dealer. Vui lòng liên hệ DC.");
      return json({ ok: true });
    }

    await handleCommand(admin, botToken, chatId, text, dealer, userId);
  } catch (err) {
    console.error("[telegram-bot] Error:", err);
    await sendDM(botToken, chatId, "Lỗi hệ thống. Vui lòng thử lại sau.").catch(() => {});
  }

  return json({ ok: true });
});

async function handleCommand(
  admin: any,
  botToken: string,
  chatId: number,
  text: string,
  dealer: { id: string; club_id: string; full_name: string },
  userId: number,
) {
  const normalizedText = text.toLowerCase().trim();

  if (normalizedText === "/start" || normalizedText === "/help" || normalizedText === "help") {
    await sendDM(
      botToken,
      chatId,
      `🤖 *VinPoker Dealer Bot*\n\n` +
        `Lệnh:\n` +
        `• /checkin — Kiểm tra trạng thái\n` +
        `• /an_com — Đăng ký nghỉ ăn cơm (+15p bonus)\n\n` +
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
    };

    await sendDM(
      botToken,
      chatId,
      `✅ *${dealer.full_name}*\n` +
        `Trạng thái: ${stateLabels[att.current_state] ?? att.current_state}`,
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

  // Unknown command
  await sendDM(botToken, chatId, "Lệnh không xác định. Gõ /help để xem lệnh.");
}