# Phase 0 — audit automation hiện hữu

## Phạm vi bằng chứng

- Audit đọc-only tại commit `21165fb7a63abb121821edcb734326318b56a04a`.
- Kết luận dưới đây là **sự thật của source**, không chứng minh migration, Cron, trigger, Edge
  Function, secret, feature flag hoặc frontend nào đang live.
- Không gọi endpoint, không truy vấn production và không đọc giá trị credential.

## Ownership inventory

| Nhóm hiện hữu | Owner theo source | Bằng chứng chính | Quyết định Phase 1 |
|---|---|---|---|
| Push in-app | DB trigger → Edge → OneSignal | `supabase/migrations/20260516123400_push_notification_dispatch.sql`; `supabase/functions/send-push-notification/index.ts` | Không insert `notifications`, không gọi Edge |
| Dealer Swing | pg_cron → RPC/Edge | `supabase/migrations/20270104000002_dealer_swing_contract_drift.sql`; `supabase/functions/process-swing/index.ts` | Giữ native, n8n không mutate |
| Dealer-ready fast/backup | DB trigger/Cron → Edge | `supabase/migrations/20260609000018_notify_dealer_ready_v2.sql`; `supabase/migrations/20260607192552_fix_backup_cron_hardcoded_auth.sql`; `supabase/functions/process-swing-on-dealer-ready/index.ts`; `supabase/functions/run-dealer-ready-backup/index.ts` | Không gọi |
| Break balance | pg_cron → Edge | `supabase/migrations/20260701000013_deadlock_recovery_schema.sql`; `supabase/functions/enforceBreakBalance/index.ts` | Giữ native |
| Dealer shift reminder | pg_cron → Edge → Telegram/OneSignal | `supabase/migrations/20261216000000_dealer_shift_reminders.sql`; `supabase/functions/send-shift-reminders/index.ts` | Không dual-send; để sau Digest/F&B |
| Pre-announce | DB queue + pg_cron → Edge | `supabase/migrations/20260607201649_create_pre_announce_jobs_table.sql`; `supabase/migrations/20260607203059_schedule_process_pre_announce_jobs_cron.sql`; `supabase/functions/process-pre-announce-jobs/index.ts` | Không consume hoặc ghi queue |
| Dealer App pool bridge | pg_cron → RPC | `supabase/migrations/20260915000000_dealer_selfcheckin_pool_bridge.sql` | Giữ native |
| Attendance cleanup | pg_cron → RPC | `supabase/migrations/20260721000000_cleanup_stale_attendance.sql`; `supabase/migrations/20261228000000_staff_attendance.sql` | Giữ native |
| F&B expiry | pg_cron → RPC | `supabase/migrations/20261111000007_fnb_expire_pending_cron.sql` | Giữ native |
| SePay reconcile | pg_cron → Edge → bank adapter | `supabase/migrations/20261115000000_sepay_reconcile.sql`; `supabase/functions/sepay-reconcile/index.ts` | Không gọi, không mô phỏng tiền thật |
| Online Poker runtime | pg_cron → Edge/RPC | `supabase/migrations/20260917000000_online_poker_runner_cron_vault.sql`; `supabase/migrations/20260923000000_online_poker_seat_heartbeat.sql` | Giữ native |
| Marketing dispatch/draft | pg_cron → Edge + delivery ledger | `supabase/migrations/20261101000002_marketing_core.sql`; `20261101000003_schedule_marketing_dispatch.sql`; `20261101000007_marketing_autocontent.sql`; `20261101000008_schedule_marketing_autocontent.sql` | Không dispatch trong V1 |
| Series capture | pg_cron → RPC | `supabase/migrations/20261126000000_series_capture_autosync.sql` | Chỉ read-only về sau |
| Staking expiry/timeout | pg_cron → RPC | `supabase/migrations/20260430211711_7822d145-1f29-4ea6-98c1-a1cf33db7479.sql`; `20260501140211_2e2da800-bbbd-43e3-87c9-35210f1e563e.sql`; `20260503130341_b6eff61a-8fa2-4543-a460-d03830600ac8.sql` | Giữ native, không mutation |
| Retention | pg_cron → SQL/RPC | `supabase/migrations/20260608173000_phase5_pr5_rollout_cleanup_and_indexes.sql`; `20270103000004_retention_cleanup_schedules.sql` | Không thay lịch |

Ma trận cutover máy đọc được nằm tại `registry/ownership-cutover.json`.

## Phát hiện cần tách thành luồng kỹ thuật riêng

1. `supabase/functions/profile-update-notify/index.ts` vừa insert vào `notifications` vừa gọi
   sender trực tiếp; vì insert đã có trigger push nên đây là rủi ro gửi đôi cần kiểm chứng riêng.
2. Source handler `supabase/functions/send-push-notification/index.ts` chưa thể hiện request-auth
   gate rõ ở phần vào; không tái sử dụng handler này trong Mock Gateway.
3. Có credential-like authorization material trong một số migration lịch sử. Không lặp lại giá
   trị; cần inventory và rotation riêng theo runbook bảo mật.
4. Cả `telegram-bot` và `telegram-webhook` tồn tại trong source. Chỉ kiểm tra live mới biết handler
   nào đang nhận webhook thật.
5. Không tìm thấy generic transactional outbox toàn hệ thống trong source audit. Các queue theo
   domain không được xem là automation outbox chung.

## Ranh giới được khóa

Phase 1 chỉ dùng fixture, SQLite local, mock recipient endpoint và delivery ledger không gửi ra
ngoài. Nó không:

- gọi Edge Function;
- insert bảng `notifications`;
- consume queue domain;
- bật Cron/job/flag;
- kết nối Supabase, Vercel, Telegram, OneSignal, Resend, Facebook, SePay hoặc Gemini;
- thay owner P0 hoặc bất kỳ module tiền, chip, lương, payout, staking hay poker online.
