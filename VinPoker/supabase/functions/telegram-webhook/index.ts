import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const allowedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const admin = createClient(supabaseUrl, serviceKey);

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * resolveClubForChat — tìm club_id từ chat_id
 * Kiểm tra: floor_manager_chat_id → telegram_chat_id → null
 */
async function resolveClubForChat(chatId: number): Promise<string | null> {
  // Sequential checks to avoid .or() returning >1 row
  const { data: fm } = await admin
    .from("club_settings")
    .select("club_id")
    .eq("floor_manager_chat_id", chatId)
    .maybeSingle();
  if (fm) return fm.club_id;

  const { data: gc } = await admin
    .from("club_settings")
    .select("club_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return gc?.club_id ?? null;
}

/**
 * checkClubAdminByTelegram — kiểm tra telegram_user_id có quyền club_admin không
 * Resolve: telegram_user_id → dealers.user_id → club_members (role club_admin/super_admin)
 */
async function checkClubAdminByTelegram(telegramUserId: number, clubId: string): Promise<boolean> {
  // Find dealer by telegram_user_id
  const { data: dealer } = await admin
    .from("dealers")
    .select("user_id")
    .eq("telegram_user_id", telegramUserId)
    .eq("club_id", clubId)
    .maybeSingle();

  if (!dealer?.user_id) return false;

  // Check role in club_members
  const { data: member } = await admin
    .from("club_members")
    .select("role")
    .eq("user_id", dealer.user_id)
    .eq("club_id", clubId)
    .maybeSingle();

  return member?.role === "club_admin" || member?.role === "super_admin";
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                        */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (allowedSecret && secret !== allowedSecret) {
    console.error("telegram-webhook: invalid secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg?.text) return new Response("ok");

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const from = msg.from;
    const telegramUserId = from?.id;
    const telegramUsername = from?.username ?? null;

    // /start
    if (text === "/start") {
      await sendMessage(chatId,
        `<b>👋 Chào mừng đến với V-Backer Dealer Bot!</b>\n\n`
        + `Dùng /link &lt;mã_dealer&gt; để liên kết tài khoản Telegram của bạn.\n`
        + `Dùng /status để xem trạng thái hiện tại.\n`
        + `Dùng /help để xem hướng dẫn.`
      );
      return new Response("ok");
    }

    // /help
    if (text === "/help") {
      await sendMessage(chatId,
        `<b>Hướng dẫn:</b>\n\n`
        + `/link &lt;mã_dealer&gt; — Liên kết tài khoản dealer với Telegram\n`
        + `/linkfloor &lt;club_id&gt; — (Floor Manager) Liên kết để nhận cảnh báo khẩn cấp\n`
        + `/status — Xem bàn hiện tại, thời gian còn lại\n`
        + `/tournamentbreak <phút> — (Club Admin) Tạm dừng tất cả bàn trong giải đấu\n`
        + `/tb <phút> — (viết tắt) Tương tự /tournamentbreak\n`
        + `Ví dụ: /link abc123, /tournamentbreak 15`
      );
      return new Response("ok");
    }

    // /link <dealer_code>
    if (text.startsWith("/link ")) {
      const dealerCode = text.slice(6).trim();
      if (!dealerCode) {
        await sendMessage(chatId, "❌ Vui lòng nhập mã dealer. Ví dụ: /link abc123");
        return new Response("ok");
      }

      let dealerId: string | null = null;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(dealerCode)) {
        dealerId = dealerCode;
      } else {
        const { data: byPhone } = await admin
          .from("dealers")
          .select("id")
          .eq("phone", dealerCode)
          .maybeSingle();
        if (byPhone) dealerId = byPhone.id;
      }

      if (!dealerId) {
        await sendMessage(chatId, "❌ Không tìm thấy dealer với mã này. Vui lòng kiểm tra lại hoặc liên hệ Floor Manager.");
        return new Response("ok");
      }

      const { data: existing } = await admin
        .from("dealers")
        .select("telegram_user_id")
        .eq("id", dealerId)
        .maybeSingle();

      if (existing?.telegram_user_id && existing.telegram_user_id !== telegramUserId) {
        await sendMessage(chatId, "⚠️ Tài khoản dealer này đã được liên kết với một tài khoản Telegram khác. Vui lòng liên hệ Floor Manager để hỗ trợ.");
        return new Response("ok");
      }

      const { error: updErr } = await admin
        .from("dealers")
        .update({
          telegram_user_id: telegramUserId,
          telegram_username: telegramUsername,
        })
        .eq("id", dealerId);

      if (updErr) {
        console.error("telegram-webhook: update error", updErr);
        await sendMessage(chatId, "❌ Không thể liên kết. Vui lòng thử lại sau.");
        return new Response("ok");
      }

      await sendMessage(chatId,
        `✅ <b>Liên kết thành công!</b>\n\n`
        + `Tài khoản dealer của bạn đã được kết nối với Telegram.\n`
        + `Dùng /status để xem thông tin ca làm việc.`
      );

      console.log(`telegram-webhook: linked dealer ${dealerId} to tg user ${telegramUserId}`);
      return new Response("ok");
    }

    // /linkfloor <club_id>
    if (text.startsWith("/linkfloor ")) {
      const clubId = text.slice(11).trim();
      if (!clubId) {
        await sendMessage(chatId, "❌ Vui lòng nhập Club ID. Ví dụ: /linkfloor uuid-cua-club");
        return new Response("ok");
      }

      // Verify club tồn tại
      const { data: club } = await admin
        .from("club_settings")
        .select("club_id")
        .eq("club_id", clubId)
        .maybeSingle();

      if (!club) {
        await sendMessage(chatId, "❌ Không tìm thấy Club với ID này.");
        return new Response("ok");
      }

      // Auth check: chỉ club_admin mới được /linkfloor
      if (!telegramUserId) {
        await sendMessage(chatId, "❌ Không thể xác định tài khoản Telegram.");
        return new Response("ok");
      }
      const isAdmin = await checkClubAdminByTelegram(telegramUserId, clubId);
      if (!isAdmin) {
        await sendMessage(chatId, "❌ Bạn không có quyền liên kết Floor Manager. Chỉ Club Admin mới được dùng lệnh này.");
        return new Response("ok");
      }

      const { error: updErr } = await admin
        .from("club_settings")
        .update({ floor_manager_chat_id: String(chatId) })
        .eq("club_id", clubId);

      if (updErr) {
        console.error("telegram-webhook: /linkfloor error", updErr);
        await sendMessage(chatId, "❌ Không thể liên kết Floor Manager. Vui lòng thử lại sau.");
        return new Response("ok");
      }

      await sendMessage(chatId,
        `✅ <b>Liên kết Floor Manager thành công!</b>\n\n`
        + `Tài khoản Telegram này sẽ nhận cảnh báo khẩn cấp từ Club.\n`
        + `Các cảnh báo bao gồm: bàn trống, dealer check-out đột ngột, pool depletion.`
      );

      console.log(`telegram-webhook: linked floor manager tg user ${telegramUserId} to club ${clubId}`);
      return new Response("ok");
    }

    // /status
    if (text === "/status") {
      if (!telegramUserId) {
        await sendMessage(chatId, "❌ Không thể xác định tài khoản Telegram của bạn.");
        return new Response("ok");
      }

      const { data: dealer } = await admin
        .from("dealers")
        .select("id, full_name, club_id")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

      if (!dealer) {
        await sendMessage(chatId, "❌ Bạn chưa liên kết tài khoản. Dùng /link &lt;mã_dealer&gt; để liên kết.");
        return new Response("ok");
      }

      const { data: att } = await admin
        .from("dealer_attendance")
        .select("id, current_state, worked_minutes_since_last_break, shift_id")
        .eq("dealer_id", dealer.id)
        .eq("status", "checked_in")
        .maybeSingle();

      if (!att) {
        await sendMessage(chatId, `📭 <b>${dealer.full_name}</b> — Bạn không có ca làm việc hôm nay.`);
        return new Response("ok");
      }

      const { data: assignment } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, assigned_at, swing_due_at,
          game_tables!inner(table_name)
        `)
        .eq("attendance_id", att.id)
        .eq("status", "assigned")
        .maybeSingle();

      if (assignment) {
        const table = assignment.game_tables as any;
        const swingDueAt = assignment.swing_due_at
          ? new Date(assignment.swing_due_at)
          : new Date(new Date(assignment.assigned_at).getTime() + 45 * 60 * 1000);
        const minutesLeft = Math.max(0, Math.round((swingDueAt.getTime() - Date.now()) / 60000));

        await sendMessage(chatId,
          `📋 <b>${dealer.full_name}</b>\n\n`
          + `🪑 Bàn: ${table.table_name}\n`
          + `⏱ Còn ${minutesLeft} phút\n`
          + `📊 Đã làm: ${att.worked_minutes_since_last_break ?? 0} phút\n`
          + `🔵 Trạng thái: ${att.current_state}`
        );
      } else if (att.current_state === "on_break") {
        await sendMessage(chatId,
          `📋 <b>${dealer.full_name}</b>\n\n☕ Đang nghỉ giải lao.\n📊 Đã làm: ${att.worked_minutes_since_last_break ?? 0} phút`
        );
      } else {
        await sendMessage(chatId,
          `📋 <b>${dealer.full_name}</b>\n\n🟢 Đang rảnh, chờ nhận bàn.\n📊 Đã làm: ${att.worked_minutes_since_last_break ?? 0} phút`
        );
      }

      return new Response("ok");
    }

    /* ============================================================== */
    /*  Tournament Break — /tournamentbreak <min> or /tb <min>        */
    /* ============================================================== */
    const tbMatch = text.match(/^\/(?:tournamentbreak|tb)\s+(\d+)$/i);
    if (tbMatch) {
      const durationMinutes = parseInt(tbMatch[1], 10);
      if (durationMinutes < 1) {
        await sendMessage(chatId, "❌ Thời gian phải lớn hơn 0. Ví dụ: /tournamentbreak 15");
        return new Response("ok");
      }
      if (durationMinutes > 90) {
        await sendMessage(chatId, "❌ Thời gian tối đa là 90 phút. Ví dụ: /tb 15");
        return new Response("ok");
      }

      // Resolve club từ chat này
      const clubId = await resolveClubForChat(chatId);
      if (!clubId) {
        await sendMessage(chatId,
          "❌ Không tìm thấy Club liên kết với chat này.\n"
          + "Floor Manager cần dùng /linkfloor &lt;club_id&gt; trước."
        );
        return new Response("ok");
      }

      // Check quyền: người gửi phải là club_admin
      if (!telegramUserId) {
        await sendMessage(chatId, "❌ Không thể xác định tài khoản Telegram.");
        return new Response("ok");
      }

      const isAdmin = await checkClubAdminByTelegram(telegramUserId, clubId);
      if (!isAdmin) {
        await sendMessage(chatId, "❌ Bạn không có quyền thực hiện lệnh này. Chỉ Club Admin mới có thể tạm dừng giải đấu.");
        return new Response("ok");
      }

      // Call manage-break internally
      try {
        const manageBreakUrl = `${supabaseUrl}/functions/v1/manage-break`;
        const response = await fetch(manageBreakUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            action: "tournament_break",
            club_id: clubId,
            duration_minutes: durationMinutes,
          }),
        });

        const result = await response.json();

        if (result.status === "tournament_break") {
          await sendMessage(chatId,
            `✅ <b>Tournament Break ${durationMinutes} phút</b>\n`
            + `• Dealer nghỉ: ${result.succeeded}\n`
            + `• Thất bại: ${result.failed}`
          );
        } else {
          await sendMessage(chatId, `⚠️ Phản hồi: ${result.message ?? JSON.stringify(result)}`);
        }
      } catch (err) {
        console.error("telegram-webhook: tournament_break error", err);
        await sendMessage(chatId, "❌ Lỗi khi gọi manage-break. Vui lòng thử lại hoặc kiểm tra logs.");
      }

      return new Response("ok");
    }

    // Unknown command
    await sendMessage(chatId, "❓ Không hiểu lệnh. Gõ /help để xem hướng dẫn.");
    return new Response("ok");
  } catch (e) {
    console.error("telegram-webhook error:", e);
    return new Response("ok");
  }
});

async function sendMessage(chatId: number, text: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("telegram-webhook sendMessage error:", e);
  }
}
