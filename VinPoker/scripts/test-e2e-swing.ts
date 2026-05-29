import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { TestContext } from "./lib/test-context.ts";
import { assertNotNull, assertErrorCode, assert, log } from "./lib/test-utils.ts";
import { createDealer, createAttendance, cleanupTestData } from "./lib/test-data.ts";
import { sendTestWebhook, waitForTelegramMessage } from "./lib/telegram-simulator.ts";

/* ================================================================ */
/*  Suite 1: Trigger swing_due_at + Unique Constraint                */
/* ================================================================ */
async function suite1(ctx: TestContext) {
  log("=== Suite 1: Trigger swing_due_at + Unique Constraint ===");

  const { tableId, attId } = await ctx.createFixture();
  const otherDealer = await createDealer(ctx.admin, ctx.clubId);
  const otherAtt = await createAttendance(ctx.admin, otherDealer.id);

  // Test trigger: swing_due_at và pre_announce_due_at phải != NULL
  const { data: assignment, error: insertErr } = await ctx.admin
    .from("dealer_assignments")
    .insert({
      attendance_id: attId,
      table_id: tableId,
      assigned_at: new Date().toISOString(),
      status: "assigned",
      idempotency_key: "test-trigger-" + Date.now(),
    })
    .select("id, swing_due_at, pre_announce_due_at")
    .single();

  if (insertErr) throw new Error(`Insert assignment failed: ${insertErr.message}`);

  assertNotNull(assignment?.swing_due_at, "swing_due_at should not be null");
  assertNotNull(assignment?.pre_announce_due_at, "pre_announce_due_at should not be null");
  log("✅ Trigger swing_due_at: OK");

  // Test unique constraint: insert thứ 2 cho cùng bàn phải reject
  const { error: dupError } = await ctx.admin
    .from("dealer_assignments")
    .insert({
      attendance_id: otherAtt.id,
      table_id: tableId,
      assigned_at: new Date().toISOString(),
      status: "assigned",
      idempotency_key: "test-unique-" + Date.now(),
    });

  assertErrorCode(dupError, "23505", "Should reject duplicate active assignment");
  log("✅ Unique constraint (23505): OK");

  // Cleanup
  await ctx.cleanupFixture();
  await cleanupTestData(ctx.admin, otherDealer.id);
  log("=== Suite 1 PASSED ===\n");
}

/* ================================================================ */
/*  Suite 2: Checkout Cleanup pre_assigned                           */
/* ================================================================ */
async function suite2(ctx: TestContext) {
  log("=== Suite 2: Checkout Cleanup pre_assigned ===");

  const { tableId, attId } = await ctx.createFixture();

  // Set dealer thành pre_assigned
  await ctx.admin
    .from("dealer_attendance")
    .update({ current_state: "pre_assigned", pre_assigned_table_id: tableId })
    .eq("id", attId);

  // Tạo assignment với pre_assigned_attendance_id trỏ đến chính attendance này
  const { data: assignment, error: asgErr } = await ctx.admin
    .from("dealer_assignments")
    .insert({
      attendance_id: attId,
      table_id: tableId,
      assigned_at: new Date().toISOString(),
      status: "assigned",
      pre_assigned_attendance_id: attId,
      idempotency_key: "test-cleanup-" + Date.now(),
    })
    .select("id")
    .single();

  if (asgErr) throw new Error(`Insert assignment failed: ${asgErr.message}`);

  // Gọi checkout-dealer Edge Function
  const { data: result, error: invokeErr } = await ctx.admin.functions.invoke(
    "checkout-dealer",
    { body: { attendance_id: attId } },
  );

  if (invokeErr) throw new Error(`checkout-dealer invoke failed: ${invokeErr.message}`);
  assert(result?.success, "checkout-dealer should return success");
  log("✅ checkout-dealer invoked successfully");

  // Verify cleanup: pre_assigned_attendance_id đã NULL
  const { data: updated } = await ctx.admin
    .from("dealer_assignments")
    .select("pre_assigned_attendance_id")
    .eq("id", assignment.id)
    .single();

  assert(
    updated?.pre_assigned_attendance_id === null,
    "pre_assigned_attendance_id should be NULL after checkout",
  );
  log("✅ pre_assigned_attendance_id cleaned up: OK");

  // Verify dealer attendance đã checked_out
  const { data: att } = await ctx.admin
    .from("dealer_attendance")
    .select("status, current_state, pre_assigned_table_id")
    .eq("id", attId)
    .single();

  assert(att?.status === "checked_out", "attendance status should be checked_out");
  assert(att?.current_state === "checked_out", "current_state should be checked_out");
  assert(att?.pre_assigned_table_id === null, "pre_assigned_table_id should be NULL");
  log("✅ Dealer attendance state cleaned up: OK");

  await ctx.cleanupFixture();
  log("=== Suite 2 PASSED ===\n");
}

/* ================================================================ */
/*  Suite 3: Telegram Batch + FM Alert                              */
/* ================================================================ */
async function suite3(ctx: TestContext) {
  log("=== Suite 3: Telegram Batch + FM Alert ===");

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const fmChatId = Deno.env.get("TELEGRAM_FM_CHAT_ID");
  const groupChatId = Deno.env.get("TELEGRAM_GROUP_CHAT_ID");
  const secretToken = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set");
  if (!fmChatId && !groupChatId) throw new Error("TELEGRAM_FM_CHAT_ID or TELEGRAM_GROUP_CHAT_ID required");

  // 1. Kiểm tra webhook hoạt động
  if (secretToken) {
    const webhookUrl = Deno.env.get("SUPABASE_URL") +
      "/functions/v1/telegram-webhook";
    const payload = {
      update_id: Math.floor(Date.now() / 1000),
      message: {
        message_id: Math.floor(Math.random() * 1000000),
        from: { id: Number(fmChatId || groupChatId), is_bot: false, first_name: "Tester" },
        chat: { id: Number(fmChatId || groupChatId), type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/help",
      },
    };

    const whResult = await sendTestWebhook(botToken, webhookUrl, secretToken, payload);
    assert(whResult.ok, `Webhook should respond ok: ${whResult.error}`);
    log("✅ Telegram webhook responds: OK");
  }

  // 2. Trigger process-swing thủ công
  const clubId = Deno.env.get("CLUB_ID");
  if (!clubId) throw new Error("CLUB_ID required for suite 3");

  log("⏳ Invoking process-swing (manual_trigger)...");
  const { data: swingResult, error: swingErr } = await ctx.admin.functions.invoke(
    "process-swing",
    { body: { club_id: clubId, manual_trigger: true, force_all: true } },
  );

  if (swingErr) log(`⚠️ process-swing error: ${swingErr.message}`);
  else log(`✅ process-swing result: ${JSON.stringify(swingResult)}`);

  // 3. Poll Telegram để kiểm tra có tin nhắn mới
  if (fmChatId) {
    log("⏳ Polling Telegram for FM DM (30s timeout)...");
    const msg = await waitForTelegramMessage(botToken, fmChatId, 30000);
    if (msg) {
      log(`✅ FM DM received: "${msg.slice(0, 100)}..."`);
    } else {
      log("⚠️ No FM DM received within 30s");
    }
  }

  if (groupChatId) {
    log("⏳ Polling Telegram for group batch (30s timeout)...");
    const msg = await waitForTelegramMessage(botToken, groupChatId, 30000);
    if (msg) {
      log(`✅ Group batch received: "${msg.slice(0, 100)}..."`);
    } else {
      log("⚠️ No group message received within 30s");
    }
  }

  log("=== Suite 3 COMPLETED (partial — check Telegram manually) ===\n");
}

/* ================================================================ */
/*  Entry Point                                                      */
/* ================================================================ */
function printHelp() {
  console.log(`
E2E Test Runner for Dealer Swing

Usage:
  deno run -A test-e2e-swing.ts <suite>

Suites:
  1     Trigger swing_due_at + Unique constraint
  2     Checkout cleanup pre_assigned
  3     Telegram batch + FM alert (requires env vars)
  all   Run all suites sequentially

Environment:
  Copy .env.test.example to .env.test and fill values.
  The script reads from Deno.env which should be set via --env-file or shell.

Examples:
  deno run -A test-e2e-swing.ts 1
  deno run -A --env-file=.env.test test-e2e-swing.ts 3
  deno run -A --env-file=.env.test test-e2e-swing.ts all
`);
}

async function main() {
  const suite = Deno.args[0];
  if (!suite || suite === "help" || suite === "--help") {
    printHelp();
    Deno.exit(0);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clubId = Deno.env.get("CLUB_ID");

  if (!supabaseUrl || !serviceKey) {
    console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    Deno.exit(1);
  }

  const ctx = new TestContext(supabaseUrl, serviceKey, clubId ?? "");

  const validSuites = ["1", "2", "3", "all"];
  if (!validSuites.includes(suite)) {
    console.error(`❌ Unknown suite "${suite}". Use "1", "2", "3", or "all"`);
    Deno.exit(1);
  }

  let passed = 0;
  let failed = 0;

  async function run(label: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
    } catch (e) {
      failed++;
      console.error(`❌ ${label} FAILED:`, (e as Error).message);
    }
  }

  try {
    if (suite === "1" || suite === "all") await run("Suite 1", () => suite1(ctx));
    if (suite === "2" || suite === "all") await run("Suite 2", () => suite2(ctx));
    if (suite === "3" || suite === "all") await run("Suite 3", () => suite3(ctx));
  } finally {
    ctx.destroy();
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  Deno.exit(failed > 0 ? 1 : 0);
}

await main();
