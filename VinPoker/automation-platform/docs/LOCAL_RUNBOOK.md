# Local runbook

## Preflight

1. Xác nhận đang ở branch `codex/automation-contract-local-v1`.
2. Xác nhận `.env` không tracked: `git status --short`.
3. Chạy `npm.cmd run verify`.
4. Chạy `docker compose config`; không dùng `--env-file` production.

Gateway và n8n không tự gắn vào network có outbound. Service `loopback-proxy` không giữ secret,
không mount volume và chỉ forward hai cổng tĩnh từ `127.0.0.1` vào network internal.
Public API của n8n bị tắt; editor local chỉ được publish qua loopback proxy.

## Runtime verification

Happy path phải kết thúc với hai event fixture `COMPLETED`, hai artifact, hai notification và không
có dead-letter. Crash matrix có thể chạy bằng `npm.cmd run verify:runtime-crash`; harness cố ý bỏ
dở sau durable enqueue, chờ lease hết hạn và xác nhận worker mới nhận lại đúng `notification_id`.
Harness chỉ dùng fixture DEV và không gửi notification ra ngoài.

## Seed và chạy Gateway

```powershell
npm.cmd run seed
npm.cmd start
```

Seed có deterministic IDs và thay thế dữ liệu local cũ. Không lấy dữ liệu từ internet.

## Kill switch

```powershell
npm.cmd run kill-switch -- GLOBAL "*" on
npm.cmd run kill-switch -- WORKFLOW owner.daily_digest.v1 on
npm.cmd run kill-switch -- WORKFLOW owner.daily_digest.v1 off
```

Kill switch chỉ thay SQLite local.
Gateway không expose endpoint đổi kill switch, nên Automation Worker HMAC không thể tự tắt
guardrail này.

## Restore drill

1. Dừng service local.
2. Sao chép `.local-data/automation-dev.sqlite` sang nơi tạm.
3. Xóa database local, chạy seed và verify fixture.
4. Khôi phục bản sao, chạy `npm.cmd run status`.
5. So sánh workflow checksum bằng `npm.cmd run checksum`.

Đây chỉ là restore của Mock Gateway. Restore n8n PostgreSQL cùng `N8N_ENCRYPTION_KEY` phải được
thử riêng trước TEST; source này chưa tuyên bố drill đó đã PASS. Không gọi Supabase backup/restore.
