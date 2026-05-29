# E2E Test — Dealer Swing

## Yêu cầu

- [Deno](https://deno.com/) >= 1.40
- Supabase project linked (`npx supabase link` đã chạy)
- Telegram Bot token (nếu chạy suite 3)

## Cài đặt

```bash
# Copy env file và điền biến
cp .env.test.example .env.test
# Sửa .env.test với giá trị thực tế
```

## Cách chạy

```bash
# Suite 1: Trigger swing_due_at + Unique constraint (không cần Telegram)
deno run -A --env-file=.env.test test-e2e-swing.ts 1

# Suite 2: Checkout cleanup pre_assigned
deno run -A --env-file=.env.test test-e2e-swing.ts 2

# Suite 3: Telegram batch + FM alert (cần TELEGRAM_BOT_TOKEN + CHAT_IDs)
deno run -A --env-file=.env.test test-e2e-swing.ts 3

# Chạy tất cả
deno run -A --env-file=.env.test test-e2e-swing.ts all
```

## Kết quả mong đợi

### Suite 1 — Trigger + Unique
- `swing_due_at` và `pre_announce_due_at` không NULL
- INSERT thứ 2 cho cùng bàn bị lỗi `23505` (unique_violation)

### Suite 2 — Checkout Cleanup
- `checkout-dealer` Edge Function trả `{ success: true }`
- `pre_assigned_attendance_id` trên assignment = NULL
- `dealer_attendance.status = 'checked_out'`, `current_state = 'checked_out'`

### Suite 3 — Telegram
- Webhook `/help` trả 200 OK
- `process-swing` hoàn tất không lỗi
- Floor Manager nhận DM (nếu có `swung_no_dealer`)
- Group nhận batch message (nếu có swing)

## Cấu trúc

```
scripts/
├── test-e2e-swing.ts           # Entry point + 3 suites
├── lib/
│   ├── test-context.ts         # TestContext class (fixture lifecycle)
│   ├── test-utils.ts           # Assertions (assertEqual, assertNotNull...)
│   ├── test-data.ts            # Fixture helpers (createDealer, createTable...)
│   └── telegram-simulator.ts   # Webhook mock + message polling
├── .env.test.example
└── README.md
```
