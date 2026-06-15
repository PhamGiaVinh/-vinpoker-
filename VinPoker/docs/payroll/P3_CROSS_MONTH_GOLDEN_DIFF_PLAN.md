# Payroll P3 — cross-month overlap: golden-period before/after diff

**Patch:** `supabase/migrations/20260907000000_payroll_p3_cross_month_overlap.sql`
**Builds on:** the live P2 body (`calculate_dealer_payroll`, md5 78e6d019…).
**Owner decisions (2026-06-16):** split each shift by actual overlap with the payroll period; regular & OT prorated by the same ratio; base-salary shift credit = fractional overlap (sums to 1 per shift; OT never inflates it).
**Run BEFORE any live apply.** Source-only; controlled Management-API apply is owner-gated. NO `db push`, NO `deploy_db`.

## What changed (vs live P2 body)
1. Period = VN-local **half-open** `[period_start, period_end)` (`p_start_date 00:00` .. `(p_end_date+1) 00:00` Asia/Ho_Chi_Minh).
2. Attendance filter widened from "check-in date in period" → "**shift overlaps period**".
3. Per shift: `overlap_ratio = overlap_minutes / total_effective_minutes` (effective checkout = P2 rule, never `now()`).
4. `regular_hours += full_regular × ratio`, `ot_hours += full_ot × ratio`, `total_hours += shift_hours × ratio`.
5. Base salary uses a **fractional shift credit** `v_shift_credit += ratio` (was `+1` per row). Break clamp `now()` → effective checkout.

## Method — dryrun-twin (zero writes)
`BEGIN … ROLLBACK`: define NEW body as `calculate_dealer_payroll_p3test`, compare to the LIVE function across the **May** and **June** periods (the live data has 2 real cross-month shifts checking in 05-31 → 06-01; only one belongs to an active FT dealer, `f6c256e8`).

## GOLDEN-DIFF RESULT (2026-06-16) — PASS
**June (31 FT dealers):** `net_negative=0`; only the cross-month dealer changes; 30 same-month dealers **byte-identical**.
| dealer | old_reg | new_reg | old_base | new_base | old_net | new_net |
|---|---|---|---|---|---|---|
| f6c256e8 (cross-month) | 52.97h | **59.51h** (+6.54) | 2,423,076 | 2,706,059 | 2,168,654 | 2,421,925 |
| 391ca197 / 4a905b44 / … (same-month) | 8.00h | 8.00h | 346,153 | 346,153 | 309,808 | 309,808 |

**May:** only `f6c256e8` changes — regular 8.00h → **1.46h** (−6.54).

**Conservation (the key invariant):**
```
f6c256e8 regular hours:  live May 8.00 + live June 52.97 = 60.97
                          P3  May 1.46 + P3  June 59.51 = 60.97   → MATCH
```
The shift's 6.54h of post-midnight work moved from May to **June** (its real month); the dealer's two-month total is unchanged.

## Acceptance (all met)
- Same-month payroll unchanged (30/31 FT dealers identical in June). ✅
- Cross-month hours allocated to the correct month (6.54h May→June). ✅
- Σ minutes across two periods = original effective minutes (60.97 = 60.97). ✅
- Regular+OT split conserved (these shifts have no OT; regular conserved). For an OT-crossing shift the split is `regular×ratio` + `ot×ratio`, conserved **by construction** (no real instance in data to golden-diff). ✅
- Shift credit sums to 1 per shift (1.46/8 + 6.54/8 = 1); OT cannot push credit > 1. ✅
- `net_negative = 0`. ✅
- No TIPS change; P0 BHXH base (`v_base_salary_vnd`) and P2 open-shift rule unchanged. ✅

## Golden cases vs result
1. Same-month → unchanged ✅ (30 dealers).
2. 31/5 22:32 → 1/6 06:32 → May 1.46h / June 6.54h ✅ (live f6c256e8).
3. 30/6 23:00 → 1/7 07:00 → June 1h / July 7h — by formula (no real instance).
4–6. starts-before / starts-inside / fully-outside → handled by `LEAST/GREATEST` clamp + zero-overlap CONTINUE.
7. OT crossing boundary → proportional split (no real instance; conserved by construction).
8. Open shift → governed by P2 effective checkout; `now()` not used. ✅

## Rollback
Re-apply `20260906000000_payroll_p2_open_shift_standard.sql` (the live P2 body). Pure calculator → single `CREATE OR REPLACE`, no data implications.
