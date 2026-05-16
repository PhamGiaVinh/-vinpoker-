# E2E Test Phase 2 — Staking Edge Functions

## 0. Pre-flight (chỉ làm 1 lần)

Hiện DB **chỉ có 1 super_admin**. Multi-sig cần 2 super_admin → tạm cấp thêm 1 admin nữa cho test:

```sql
-- Trong Cloud → SQL Editor: cấp super_admin cho 1 user khác để test co-sign
INSERT INTO public.user_roles (user_id, role)
VALUES ('<USER_ID_ADMIN_2>'::uuid, 'super_admin')
ON CONFLICT DO NOTHING;
```

> Sau khi test xong nhớ revoke nếu user đó không phải admin thật:
> `DELETE FROM user_roles WHERE user_id='<...>'::uuid AND role='super_admin';`

## 1. Seed deal test

Chạy `seed-test-deal.sql` → copy `id` ra (gọi là `DEAL_ID`).

Số liệu kỳ vọng:
- `asking_price_vnd` = `escrow_amount_vnd` = **2,400,000**
- Khi prize = 30,000,000:
  - `player_payout_vnd` = **24,400,000**
  - `backer_payout_vnd` = **5,000,000**
  - `platform_fee_vnd` = **600,000**
  - Tổng = 30,000,000 ✓

## 2. Lấy 3 JWT

Đăng nhập app bằng 3 tài khoản khác nhau (3 trình duyệt / 3 cửa sổ ẩn danh).
Với mỗi tài khoản: DevTools → Application → Local Storage → key `sb-tprwipyoqtfdclnamwjt-auth-token` → copy `access_token`.

| Vai trò | Token env | Yêu cầu |
|---|---|---|
| Backer | `BACKER_TOKEN` | user thường, KHÁC player của deal |
| Admin #1 (requester) | `ADMIN1_TOKEN` | super_admin |
| Admin #2 (co-signer) | `ADMIN2_TOKEN` | super_admin, KHÁC Admin #1 |

## 3. Chạy test

```bash
export PROJECT_REF="tprwipyoqtfdclnamwjt"
export ANON_KEY="<SUPABASE_ANON_KEY trong .env>"
export DEAL_ID="<từ bước 1>"
export BACKER_TOKEN="..."
export ADMIN1_TOKEN="..."
export ADMIN2_TOKEN="..."

bash supabase/functions/_staking_shared/test-staking.sh
```

## 4. Checklist sau test (BẮT BUỘC)

Mở `verify-test.sql`, thay `<DEAL_ID>` và chạy. Kỳ vọng:

| # | Check | Expected |
|---|---|---|
| 1 | `staking_deals.status` | `released` |
| 1 | `player_payout_vnd / backer_payout_vnd / platform_fee_vnd` | `24400000 / 5000000 / 600000` |
| 2 | Audit trail có 8 dòng theo đúng thứ tự | created → reviewed (auto từ trigger nếu admin update review_status; ở seed là tạo trực tiếp 'approved' nên có thể không có dòng `reviewed`) → committed → funded → result_entered → admin_override → release_requested → release_cosigned → released |
| 3 | Ledger có **4 dòng** | `fund_lock`(2.4M) + `payout_player`(24.4M) + `payout_backer`(5M) + `platform_fee`(0.6M) |
| 4 | `diff` (prize − total_payouts) | **= 0** |
| 5 | `BAD_SAME_ADMIN` | **`f` (false)** — requester ≠ cosigner |

## 5. Test cases trong script

### Happy path (PASS = 200)
1. `commit-deal` — backer khoá deal
2. `confirm-funded` — admin xác nhận tiền vào escrow (đúng số tiền)
3. `enter-result` — nhập prize, hệ thống auto-tính chia
4. `admin-override` — bypass 2-party confirm (vì chưa có UI cho player/backer)
5. `request-release` — admin1 tạo release request
6. `cosign-release` — admin2 (≠ admin1) ký xác nhận
7. `execute-release` — chuyển tiền + ghi 3 ledger rows

### Fail-safe (PASS = đúng mã lỗi)
- **A**: cosign bằng cùng admin → **403** (`Co-signer must be a different admin than requester`)
- **B**: confirm-funded số tiền lệch 1 VND → **400** (`Amount mismatch`)
- **C**: commit-deal trên deal đã commit → **400** (`Deal not available`)
- **D**: execute-release lần 2 → **409** (`Already executed`)

## 6. Báo cáo

- Tất cả 11 test cases trong script đều `✔` → Phase 2 OK, sẵn sàng build UI Phase 3.
- Có bất kỳ `✘` nào → dán log lên đây, tôi fix trước khi đi tiếp.
