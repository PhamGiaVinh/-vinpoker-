# VBacker Automation Platform — local contract slice

Đây là **source implementation cho Đợt 0 và vertical slice Đợt 1 DEV local** của Owner Daily
Digest. Mock Gateway Node và fixture có thể chạy local; container n8n/PostgreSQL chưa được khởi
động trong phiên này. Đây không phải backend production và không được kết nối với
Supabase/Vercel/provider thật.

## Phạm vi đã khóa

- JSON Schema V1 và payload schema riêng theo event.
- Ownership/cutover registry.
- Mock Automation Gateway dùng SQLite local.
- HMAC có nonce, replay window, rotation và rate limit.
- Claim/lease/fairness, artifact deterministic, enqueue idempotent và complete.
- Hai CLB fixture, mock delivery ledger (`QUEUED → SENT / RETRY_WAIT / UNKNOWN → RECONCILED`)
  và dashboard localhost tối giản. Dispatcher mock không có network call hoặc provider credential.
- n8n workflow export chỉ dùng node allowlist; không Schedule Trigger, Code, DB hoặc provider.
- Audit source hiện hữu và ownership/cutover matrix; mọi kết luận live vẫn để ngỏ.

## Không nằm trong phạm vi

- Không migration/RPC/Edge Function.
- Không đọc hoặc ghi Supabase.
- Không gửi OneSignal, Telegram, email hoặc payment.
- Không thay P0 path, Dealer Swing, F&B expiry, SePay hay Online Poker.
- Không production deploy, flag hoặc recipient thật.

## Chạy nhanh

Yêu cầu Node.js 24+.

```powershell
cd "D:\wt\automation-contract-local-v1\VinPoker\automation-platform"
Copy-Item .env.example .env
# Thay toàn bộ giá trị replace-with-* bằng secret DEV ngẫu nhiên.
npm.cmd install
npm.cmd run verify
npm.cmd run seed
npm.cmd start
```

Mở `http://127.0.0.1:8787/dashboard`.

## n8n local

Đây là runbook cho một lượt triển khai local riêng sau khi Owner cho phép; các lệnh dưới đây chưa
được chạy trong slice hiện tại.

```powershell
docker compose config
docker compose up -d
```

Sau khi n8n mở ở `http://127.0.0.1:5678`:

1. Tạo credential Crypto tên `Automation Worker HMAC DEV`.
2. Secret phải khớp `AUTOMATION_HMAC_CURRENT_KEY` trong `.env`.
3. Import helper workflow trước, rồi import Owner Daily Digest.
4. Không publish sang môi trường khác.

`compose.yaml` bind cả n8n và Gateway vào loopback; network Docker là internal.

Đợt 1 chỉ được nâng từ **CONDITIONAL** sau khi workflow được import/chạy bằng fixture, `n8n audit`
được kiểm tra và restore drill đạt PASS.

## Semantics

- Event processing: at-least-once.
- Notification enqueue: effectively-once theo idempotency key.
- Provider delivery: at-least-once; mock adapter chỉ diễn tập state machine cục bộ, không gửi ra ngoài.
- `/complete` chỉ sau khi notification đã được ghi bền vững.
- P0 không đi qua n8n.

Chi tiết: [docs/IMPLEMENTATION_BOUNDARY.md](docs/IMPLEMENTATION_BOUNDARY.md).

Audit source-only: [docs/PHASE0_SOURCE_AUDIT.md](docs/PHASE0_SOURCE_AUDIT.md).
