// deno test supabase/functions/marketing-dispatch/dispatchLogic.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  channelsNeedingSend,
  computePostStatus,
  IMPLEMENTED_CHANNELS,
  parseChannels,
  telegramSendMode,
  validTelegramPhotos,
} from "./dispatchLogic.ts";

Deno.test("parseChannels: keeps known channels, drops junk + dups", () => {
  assertEquals(parseChannels(["telegram", "facebook"]), ["telegram", "facebook"]);
  assertEquals(parseChannels(["telegram", "telegram"]), ["telegram"]);
  assertEquals(parseChannels(["x", 1, null, "zalo"]), ["zalo"]);
  assertEquals(parseChannels("telegram"), []);
  assertEquals(parseChannels(undefined), []);
});

Deno.test("channelsNeedingSend: skips already-sent (exactly-once)", () => {
  assertEquals(channelsNeedingSend(["telegram", "facebook"], []), ["telegram", "facebook"]);
  assertEquals(channelsNeedingSend(["telegram", "facebook"], ["telegram"]), ["facebook"]);
  assertEquals(channelsNeedingSend(["telegram"], ["telegram"]), []);
});

Deno.test("computePostStatus: sent only when all delivered", () => {
  assertEquals(computePostStatus(1, 1), "sent");
  assertEquals(computePostStatus(2, 2), "sent");
  assertEquals(computePostStatus(2, 1), "failed");
  assertEquals(computePostStatus(0, 0), "failed"); // no channels = not a success
});

Deno.test("implemented adapters: telegram + facebook (zalo not yet)", () => {
  assertEquals(IMPLEMENTED_CHANNELS.has("telegram"), true);
  assertEquals(IMPLEMENTED_CHANNELS.has("facebook"), true);
  assertEquals(IMPLEMENTED_CHANNELS.has("zalo"), false);
});

Deno.test("validTelegramPhotos: keeps storage http URLs, drops junk, caps 10", () => {
  const good = "https://x.supabase.co/storage/v1/object/public/app-assets/marketing/a.jpg";
  assertEquals(validTelegramPhotos([good, "not-a-url", "ftp://x/y", 1, null]), [good]);
  assertEquals(validTelegramPhotos("nope"), []);
  assertEquals(validTelegramPhotos(Array(12).fill(good)).length, 10);
});

Deno.test("telegramSendMode: 0->text, 1->photo, 2+->group", () => {
  assertEquals(telegramSendMode(0), "text");
  assertEquals(telegramSendMode(1), "photo");
  assertEquals(telegramSendMode(2), "group");
  assertEquals(telegramSendMode(7), "group");
});
