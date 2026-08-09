# Threat model DEV local

| Mối đe dọa | Kiểm soát trong slice |
|---|---|
| Replay request | Timestamp ±5 phút, nonce lưu 10 phút, unique nonce theo key |
| Lộ key giữa môi trường | Header environment bắt buộc; key id scoped DEV |
| Worker cũ hoàn tất job | Lease token và lease expiry được kiểm tra lại |
| Noisy tenant | Fair-share theo CLB, tối đa hai lease/CLB/workflow |
| Duplicate enqueue | Unique logical key, cùng request trả cùng notification ID |
| Poison event | Schema/policy lỗi đi dead-letter, không chặn event khác |
| SSRF từ workflow | Workflow scanner chỉ cho `http://gateway:8787` |
| Secret/PII trong export | Scanner tìm marker secret, endpoint production, PII fixture |
| Browser vượt quyền | Dashboard chỉ đọc và chỉ localhost; kill switch chỉ qua CLI local |
| Worker tự tắt guardrail | Gateway không expose endpoint đổi kill switch; n8n chỉ được đọc kết quả guardrail |
| n8n tắt | Event fixture còn trong SQLite; P0 không phụ thuộc n8n |

## Trust boundaries

- n8n không truy cập database VinPoker.
- Mock Gateway không có Supabase/provider/payment credential.
- Provider adapter chỉ ghi ledger mock.
- Dashboard không phải auth production và không được expose.

## Chưa giải quyết ở DEV

- HSM/KMS, WAF, multi-region failover và 24/7 monitor.
- Auth/RLS deep-link production.
- Provider reconciliation thật.
- n8n commercial multi-club licensing.

`n8n audit` vẫn phải chạy sau khi import workflow vào instance local; scanner source không thay thế
security audit của instance đang chạy.
