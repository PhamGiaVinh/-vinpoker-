// deno test supabase/functions/marketing-dispatch/dispatchLogic.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  channelsNeedingSend,
  computePostStatus,
  IMPLEMENTED_CHANNELS,
  parseChannels,
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

Deno.test("P0: only telegram has an implemented adapter", () => {
  assertEquals(IMPLEMENTED_CHANNELS.has("telegram"), true);
  assertEquals(IMPLEMENTED_CHANNELS.has("facebook"), false);
  assertEquals(IMPLEMENTED_CHANNELS.has("zalo"), false);
});
