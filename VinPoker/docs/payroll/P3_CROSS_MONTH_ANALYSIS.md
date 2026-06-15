# Payroll P3 — cross-month overnight attribution (ANALYSIS — owner-gated, no patch yet)

**Status:** analysis + golden demonstration only. Owner directive 2026-06-16: **STOP after report; do NOT apply; do NOT mix with P2.** No migration/code committed until owner approves the source patch.

## Current behavior (proof)
In `calculate_dealer_payroll` the attendance loop filters:
```sql
WHERE da.check_in_time::DATE BETWEEN p_start_date AND p_end_date
```
and counts the **whole** shift duration (`check_out − check_in`). So an overnight shift that crosses a month boundary is attributed **entirely to the check-in month**; the next month gets nothing.

**Server timezone = `Asia/Ho_Chi_Minh`** → `check_in_time::DATE` already buckets in VN local time, so there is **no timezone bug** to fix — only the whole-shift attribution.

**Live evidence (2026-06-16) — 2 real cross-month shifts:**
| dealer | check-in (VN) | check-out (VN) | total | currently counted in | should be May / June |
|---|---|---|---|---|---|
| b3765683 | 05-31 22:16 | 06-01 06:16 | 8.00h | **all in May** | 1.73h / **6.27h** |
| f6c256e8 | 05-31 22:32 | 06-01 06:32 | 8.00h | **all in May** | 1.46h / **6.54h** |

→ June is **undercounted by ~12.8h** (counted in May instead). Overlap split sums exactly to the original duration (8.00h) for both.

## Proposed logic (owner policy)
Count only the portion of each shift that overlaps the requested period:
```
period_start_ts = p_start_date            00:00 Asia/Ho_Chi_Minh
period_end_ts   = (p_end_date + 1 day)    00:00 Asia/Ho_Chi_Minh   -- exclusive
worked_seconds_in_period = GREATEST(0,
    EXTRACT(EPOCH FROM (LEAST(check_out, period_end_ts) - GREATEST(check_in, period_start_ts))))
```
And widen the filter from "check-in in period" to "**shift overlaps period**":
```sql
WHERE da.check_in_time < period_end_ts AND COALESCE(da.check_out_time, …) > period_start_ts
```
(So a shift checking in 05-31 contributes its post-midnight hours to the **June** period, which today it does not.)

## Golden cases (to verify before apply)
1. Same-month shift → unchanged.
2. 30/6 23:00 → 1/7 07:00 → June 1h, July 7h.
3. 31/7 20:00 → 1/8 04:00 → July 4h, Aug 4h.
4. Shift starts before period, ends inside → only the in-period tail counts.
5. Shift starts inside, ends after period → only the in-period head counts.
6. Shift fully outside period → 0.
7. Open shift (no check-out) → **report only, do NOT change here** (that is P2, already live: open shift = 1 standard shift).
**Invariant:** sum of a shift's minutes across its two months == original duration.

## ⚠️ Two design decisions the owner must make BEFORE a patch
The overlap split is straightforward for *hours*, but two downstream allocations are NOT obvious and change pay:

1. **Regular vs OT split on a partial shift.** OT = hours over the standard shift length. If an 8h shift is split 1.73h May / 6.27h June, do we:
   - (a) compute regular/OT on the **full** shift, then prorate each to the period by its overlap fraction? (keeps total OT correct), or
   - (b) treat each month's in-period hours independently against the standard? (could understate OT).
   **Recommend (a).**
2. **Shift count for base-salary proration.** FT base salary = `monthly_salary × LEAST(shifts, standard)/standard`. A cross-month shift currently = 1 shift in the check-in month. After the split, does it count as:
   - (a) a **fraction** of a shift in each month (by hour share), or
   - (b) 1 whole shift in the month with the majority of hours, or
   - (c) 1 whole shift in **both** months (double-counts → overpays base)?
   **Recommend (a) fractional, or (b) majority-month** — NOT (c).

Without a decision on these, the hours split alone would mis-allocate OT and base salary. This is exactly why P3 is analysis-first.

## Impact & risk
- **Small live impact today** (only 2 cross-month shifts in current data), but correctness matters at month-end close and grows with overnight tournaments.
- Bigger code change than P0/P2 (filter + per-shift clamp + the two allocations above) → must be golden-diffed across a real month boundary (May vs June) before apply.
- Interacts with P2 (open shift) only at the filter — keep them separate as the owner directed.

## Recommendation
1. Owner decides the two allocation rules above (Regular/OT split + shift-count).
2. Then author the source patch (new migration), golden-diff May+June for the 2 affected dealers (expect May hours ↓, June hours ↑, totals conserved, same-month dealers unchanged), and only then owner-gated apply.
3. Suggest sequencing P3 **after** P4b-1 (insurance_mode), since P4b-1 has far larger net-pay impact; P3 is a precision fix.

**Stop here for owner approval** (per directive).
