# PL-PR1 — Payment Lifecycle Foundation (design + UAT plan)

**Status:** SOURCE-ONLY — migration `20260819000005` is NOT applied to any DB.
Per the agreed order: review → merge source-only → **separate controlled live apply** → UAT.
**App KHÔNG giữ tiền** — these states record payment status; no money moves in the app.

## Lifecycle

```
draft → submitted → approved → locked → payment_prepared → paid → reconciled
                       ↑          (terminal for editing — see save guard below)
                    rejected ↔ draft/submitted (existing flow, unchanged)
```

- `transition_payroll_status` (existing RPC) still owns draft→…→locked and is untouched.
- Three NEW SECURITY DEFINER RPCs own the payment chain (existing fn has no room for
  role checks per-transition and payment needs them):

| RPC | Transition | Status preconditions | Authorization (server-side) |
|---|---|---|---|
| `prepare_payroll_payment(period, actor, method, note?)` → record id | locked → payment_prepared | period `locked`, no existing payment record | super_admin · club_admin · (cashier/club_cashier **với link `club_cashiers` đúng club**) |
| `mark_payroll_paid(period, actor, payment_ref, paid_at?, note?)` | payment_prepared → paid | period `payment_prepared`, record `prepared`, `payment_ref` bắt buộc | như prepare |
| `reconcile_payroll_payment(period, actor, recon_ref?, note?)` | paid → reconciled | period `paid`, record `paid` | **club_admin/super_admin ONLY** + **reconciler ≠ payer (hard rule)** |

## Double-pay protection (3 lớp)

1. `uq_payment_records_period` — duy nhất MỘT payment record cho mỗi period (unique_violation → lỗi rõ ràng)
2. Record status machine `prepared → paid → reconciled` — pay lần 2 bị chặn vì record không còn `prepared`
3. `uq_payment_records_club_payment_ref` — một `payment_ref` không dùng lại được trong cùng club

Void/reverse/partial payment = future PR (PL-PR2+), đúng yêu cầu owner.

## Audit

Mỗi transition ghi một `payroll_audit_log` row: `action='UPDATE'` (CHECK constraint chỉ cho INSERT/UPDATE/DELETE — same convention as B7), `reason` = `PL1 prepare payment` / `PL1 mark paid` / `PL1 reconcile payment`, old/new chứa status + refs + record id + (prepare) snapshot tổng tiền.

## Immutability sau locked (save guard extension — justified change to save_payroll_period)

B7's guard chỉ chặn `status='locked'`. Khi lifecycle thêm 3 status mới, một period `paid` sẽ KHÔNG còn là 'locked' → re-save sẽ đè rows đã thanh toán. PL-PR1 mở rộng guard thành `status IN ('locked','payment_prepared','paid','reconciled')` — **đúng 1 dòng + 1 message**, phần B7 server-recompute giữ nguyên (base = migration `20260819000003`, md5 `65d547eb…`; body mới md5 `7fa076bd79a57949160d9e068d84f9b7`).

`payment_records.total_net_vnd/dealer_count` snapshot lúc prepare = bằng chứng "số tiền chuẩn bị chi" tại thời điểm đó (chỉ cộng từ rows server-computed của B7, loại `excluded`).

## RLS

`payment_records`: SELECT cho super_admin/club_admin/cashier-có-link-club; **không có** INSERT/UPDATE/DELETE policy — mọi write đi qua RPC SECURITY DEFINER. Grants: revoke PUBLIC/anon, grant EXECUTE cho authenticated + service_role.

## Known v1 limitations (chấp nhận, ghi rõ)

1. `club_admin`/`super_admin` là role GLOBAL (user_roles không club-scoped) — một club_admin về lý thuyết chuẩn bị/chi cho club khác. Khắc phục thật cần club-scoped admin table (future).
2. Reconciler ≠ payer là hard rule — club một-người sẽ cần user thứ hai (athena có club_admin trên test DB). Override flag qua club_settings = future nếu owner muốn.
3. Không có path quay lui từ payment states (no unpay/void) — by design v1.
4. Adjustments vẫn insert trực tiếp từ frontend không qua guard (lỗ hổng pre-existing, micro ticket riêng — sau khi locked vẫn thêm adjustment được; KHÔNG sửa trong PL-PR1).

## Rollback SQL (khi đã apply mà cần lui)

```sql
DROP FUNCTION IF EXISTS public.prepare_payroll_payment(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mark_payroll_paid(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.reconcile_payroll_payment(UUID, UUID, TEXT, TEXT);
DROP TABLE IF EXISTS public.payment_records;          -- only if no rows worth keeping
ALTER TABLE public.payroll_periods DROP CONSTRAINT IF EXISTS chk_payroll_status;
ALTER TABLE public.payroll_periods ADD CONSTRAINT chk_payroll_status
  CHECK (status IN ('draft','submitted','approved','locked','rejected'));
-- ^ only safe while no row uses the 3 new statuses
-- restore save_payroll_period: re-run body from 20260819000003 (B7, md5 65d547eb…)
-- new payroll_periods columns are nullable additive — leave or drop if all NULL
```

## UAT test plan (chạy ở phase F, SAU controlled live apply — không chạy bây giờ)

Fixture: **club 11 June period** (`f96489c6…`, hiện draft, 2 dealers server-computed) — đưa tới locked qua flow thường (submit → approve → lock bằng UI/RPC), client 22 golden KHÔNG đụng. Actors: vbacker (cashier+club_admin, link 2 club) làm prepare/pay; **athena** (club_admin) làm reconcile.

Negative (mỗi test expect EXCEPTION, không ghi gì):
1. `prepare` khi period đang `draft`/`approved` → "Expected status locked"
2. `mark_paid` khi chưa prepare → "Expected status payment_prepared"
3. `reconcile` khi chưa paid → "Expected status paid"
4. `prepare` lần 2 sau khi đã prepare → double-pay guard message
5. `mark_paid` lần 2 / re-use `payment_ref` cùng club → guard message
6. Actor không có role (vd player) → "not authorized"
7. Cashier club khác (không có row `club_cashiers` cho club này, không admin role) → "not authorized"
8. `reconcile` bởi chính payer → "Reconciler must be different from the payer"
9. `save_payroll_period` trên period `paid` → "locked or in payment lifecycle"
10. Golden fixture club 22: md5 `4a786968…` không đổi sau toàn bộ UAT

Positive:
11. Chain đầy đủ: locked → prepare (record với total_net snapshot đúng Σ stored net) → paid (ref ghi nhận) → reconciled (actor khác) — mỗi bước 1 audit row đúng reason, period columns by/at populated

## PR split tiếp theo

- **PL-PR2**: controlled live apply (separate session, snapshot/verify như B7 pattern) + UAT ở trên
- **PL-PR3**: frontend workflow UI (UIUX Phase 5 declaration) — nút Prepare/Paid/Reconcile + hiển thị payment record
- **PL-PR4** (optional): void/reverse flow, club-scoped admin, same-actor override flag
