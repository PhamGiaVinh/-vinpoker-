import { assertEquals } from "jsr:@std/assert@1";
import {
  boundedRetryAfterSeconds,
  parsePayrollStatementDeliveryRequest,
  safeTelegramProviderCode,
  sanitizePayrollStatementDeliveryError,
} from "../functions/send-payroll-statement/runtime.ts";

const operationId = "11111111-1111-4111-8111-111111111111";

Deno.test("payroll Telegram delivery accepts an operation intent only", () => {
  assertEquals(parsePayrollStatementDeliveryRequest({ operation_id: operationId }), { operation_id: operationId });
  assertEquals(parsePayrollStatementDeliveryRequest({ operation_id: operationId, chat_id: "123" }), null);
  assertEquals(parsePayrollStatementDeliveryRequest({ operation_id: operationId, amount_vnd: 1_000_000 }), null);
  assertEquals(parsePayrollStatementDeliveryRequest({ operation_id: "not-a-uuid" }), null);
});

Deno.test("provider outcomes are stable and never expose Telegram response text", () => {
  assertEquals(safeTelegramProviderCode(429), "TELEGRAM_HTTP_429");
  assertEquals(safeTelegramProviderCode(403), "TELEGRAM_HTTP_403");
  assertEquals(safeTelegramProviderCode(null, true), "TELEGRAM_TRANSPORT_UNKNOWN");
  assertEquals(
    sanitizePayrollStatementDeliveryError({ code: "XX000", message: "private 123456 https://private.invalid" }),
    "PAYROLL_DELIVERY_FAILED",
  );
  assertEquals(
    sanitizePayrollStatementDeliveryError({ code: "TELEGRAM_HTTP_429", message: "private 123456" }),
    "TELEGRAM_HTTP_429",
  );
});

Deno.test("retry-after is bounded before it reaches the ledger", () => {
  assertEquals(boundedRetryAfterSeconds("12"), 12);
  assertEquals(boundedRetryAfterSeconds("0"), null);
  assertEquals(boundedRetryAfterSeconds("999999"), null);
  assertEquals(boundedRetryAfterSeconds("12.5"), null);
});
