# Ranh giới triển khai

## Trạng thái

| Giai đoạn | Nội dung | Trạng thái sau slice này |
|---|---|---|
| 0 | Audit, registry, contract, threat model | Source artifacts đã hoàn tất |
| 1 | DEV local, Mock Gateway, fixture, Digest | **LOCAL E2E READY**; không phải TEST/production |
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

## Bằng chứng runtime đã có

- Image `n8nio/n8n:2.32.6` được khóa tại
  `n8nio/n8n@sha256:5f7856f4fc7cd935230f7596e39fdb3d5eda0e379c5b40b699b9c0eb35ebd0bf`;
  Postgres và Gateway chạy trong Compose DEV.
- Hai workflow được import, thực thi bằng fixture rồi trả về inactive.
- Happy path kết thúc với 2 event `COMPLETED`, 2 artifact, 2 notification, 0 backlog và 0 dead-letter.
- Crash matrix thật xác nhận lease cũ bị từ chối, worker mới nhận attempt 2 và dùng lại cùng durable
  notification thay vì tạo bản trùng.
- Restart toàn stack giữ nguyên SQLite ledger, PostgreSQL workflow và credential.
- `n8n audit` đã chạy trên instance. Image 2.32.6 cần ESM extension loader tạm cho chính lệnh audit;
  loader không được giữ trong image/source. Public API đã tắt. Finding còn lại là HTTP Request node
  được khóa vào Gateway nội bộ và credential DEV không gắn workflow active theo chủ ý.
- PostgreSQL và SQLite được backup rồi restore vào Compose project/volume mới. Workflow restore chạy
  happy path thành công, chứng minh credential giải mã được bằng encryption key DEV hiện hữu.
- `npm audit --omit=dev` không còn vulnerability sau khi nâng transitive `fast-uri` lên bản đã vá.

## Bằng chứng chưa có

- Chưa chứng minh TEST shadow, provider adapter, recipient thật hoặc host 24/7.
- Chưa có migration/RPC/Edge/outbox production và không có production apply/deploy/flag.

Do đó **SOURCE READY** và **LOCAL E2E READY**; **USER-VISIBLE ngoài localhost** và
**PRODUCTION vẫn NOT READY**.
