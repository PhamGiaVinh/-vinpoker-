# B5 SAVED NET RECOMBINE — controlled patch record + golden diff (2026-06-13)

**Operation:** payroll_b5_saved_net_recombine (Supabase Ops Level 3)
**Target DB:** linked project `orlesggcjamwuknxwcpk`
**Object touched:** `public.calculate_club_payroll(uuid, date, date)` — saved branch, ONE expression

## What changed

```
OLD: 'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_vnd, 0),
NEW: 'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0) + COALESCE(v_total_adjustments, 0),
```

Saved-period owner-facing net = stored after-tax snapshot + current live adjustments.
Stored `dealer_payroll` rows are NEVER rewritten (read path only).
Unsaved live-calc branch untouched (textual diff = only the one line + comment).

## Preflight evidence (read-only, 2026-06-13)

- Exactly 1 overload `calculate_club_payroll(uuid,date,date)`; pre-patch live md5 `afd930661dbf898a85e2909fd5fb6a2b` — snapshot byte-identical in `PRE_B5_calculate_club_payroll_live_snapshot_20260613.sql`
- Golden fixture verified: June 2026, club `22222222…`, status approved, NOT locked, 29 dealer_payroll rows, 1 adjustment +500,000 (`UAT-PR18-saved-path`)
- 0 dealer_payroll rows with `net_pay_after_tax_vnd IS NULL` → simple recombine expression safe
- `net_pay_vnd` consumers: 6 frontend files, all display/export; none recombine themselves → no double count
- No `add_payroll_adjustment` RPC exists (frontend inserts directly) → locked-period adjustment guard is a FOLLOW-UP item, not fixed here

## Golden-period diff (mandatory verification) — PASS

| Metric | BEFORE | AFTER |
|---|---|---|
| Dealers returned | 29 | 29 (28 byte-identical) |
| Changed dealers | — | 1 (dl 12 only) |
| Changed fields | — | `net_pay_vnd` only: 5,297,000 → 5,797,000 (= +500,000 adjustment, exact) |
| Total net | 49,526,842 | 50,026,842 (+500,000 exact) |
| Stored dealer_payroll md5 (`string_agg(dp::text)` ordered) | `4a786968725b8879272ee701e576579b` | `4a786968725b8879272ee701e576579b` — **byte-identical** |
| Live function md5 | `afd93066…` | `8932bb8f8b2c880738c1008e57268789` == locally computed patched md5 (proof nothing else changed) |

## UI verification (prod-build worktree `3e438bc`, logged in as vbacker)

- "Cần chuẩn bị chi trả" = **50.026.842 ₫** (was 49.526.842)
- Mismatch card "CHÊNH LỆCH ĐIỀU CHỈNH": **gone**
- Decision strip: **"Sẵn sàng duyệt"** — "Không phát hiện rủi ro chặn"
- dl 12 row: sau thuế 5.297.000 ₫ · điều chỉnh 500.000 ₫ · thực lãnh **5.797.000 ₫**
- Period status "Đã duyệt" + actor metadata unchanged; fixture NOT locked

## Rollback

Re-apply the pre-patch snapshot (CREATE OR REPLACE, instant, zero data loss):

```
docs/emergency_rollbacks/PRE_B5_calculate_club_payroll_live_snapshot_20260613.sql
```

(Restores the pre-B5 display semantics: saved net = stale snapshot; mismatch card returns.)

## Constraints honored

- deploy_db=true used: NO
- supabase db push used: NO
- schema_migrations changed: NO (version `20260818000001` is source-only, not in history)
- pending migrations applied: NO
- formula (calculate_dealer_payroll) untouched · B2/B7/payment lifecycle untouched
- June 2026 fixture NOT locked · stored rows NOT mutated
