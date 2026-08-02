# Ranh giới triển khai

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái sau slice này |
|---|---|---|
| 0 | Audit, registry, contract, threat model | Source artifacts đã hoàn tất |
| 1 | DEV local, Mock Gateway, fixture, Digest | Source + Mock Gateway Node đã verify; n8n/Docker chưa khởi động |
| 2 | Transactional outbox/Gateway production source | Chưa làm |
| 3+ | TEST shadow, canary, production | Chưa làm |

## Invariant được thực thi

1. Gateway chạy standalone chỉ bind loopback trong DEV; khi ở Docker, service chỉ nằm trên
   network nội bộ và cổng host vẫn bind loopback.
2. Mọi endpoint thay đổi state cần HMAC, nonce và environment đúng.
3. Worker cũ không thể heartbeat/complete sau khi mất lease.
4. Enqueue lặp với cùng logical key trả cùng `notification_id`.
5. Recipient endpoint chỉ tồn tại trong Gateway fixture; n8n không nhận endpoint.
6. Digest chỉ dùng tổng số liệu; không có PII, bank data hoặc lương cá nhân.
7. Workflow không có Schedule Trigger, provider, database hoặc Code node.
8. Kill switch được kiểm tra ở claim, preflight, artifact và enqueue.
9. Mock delivery chỉ chuyển ledger local; trạng thái `UNKNOWN` không retry trước reconciliation,
   và replacement chỉ được tạo sau `CONFIRMED_NOT_SENT`.

## Invariant chỉ mô phỏng

Transactional outbox được test bằng SQLite transaction trong mock store. Đây không phải
migration production và không chứng minh Supabase live đã có outbox.

Server-side schedule được biểu diễn bằng fixture `owner.daily_digest.due`; n8n không tạo lịch.
Cron/RPC production vẫn là Đợt 2 source-only và cần cổng RED riêng.

## P0

P0 tiếp tục đi qua sender server-native hiện tại. Workflow local từ chối event severity `P0`.

## Bằng chứng chưa có

- Chưa chạy container n8n hoặc PostgreSQL.
- Chưa import/chạy workflow trong một n8n instance.
- Chưa chạy `n8n audit`.
- Chưa thực hiện backup/restore drill.
- Chưa chứng minh TEST shadow, provider adapter hoặc recipient thật.

Vì vậy Đợt 1 vẫn là **CONDITIONAL** cho đến khi có một lệnh triển khai local riêng và các bước
runtime trên được kiểm chứng bằng fixture.
