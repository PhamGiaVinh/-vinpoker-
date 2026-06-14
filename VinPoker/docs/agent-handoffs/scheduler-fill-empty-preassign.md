# Spec — Pre-assign soonest-free dealer to an empty open table

**Status:** DRAFT — awaiting owner approval before any `process-swing` change.
**Author:** dealer-swing session, 2026-06-15.
**Module:** Dealer Swing scheduler (`process-swing`, protected). Separate PR; do NOT mix with #135/#138.

## 1. Owner intent (verbatim, 2026-06-15)

> "floor mở bàn nhưng không có dealer, bàn có thể trống, ví dụ dealer A còn 6 phút nữa hết break, thì dealer A phải được **pre-assigned** vào bàn trống giống như lúc mở bàn, gửi tin nhắn mở bàn + đồng hồ đếm ngược khi đã làm."

Scenario: floor opens a table (active) but no dealer is free right now. The soonest-free dealer (e.g. A, 6 min left on break) should be **pre-assigned** to that empty table immediately, with an open-table Telegram message + countdown; A takes the table when their break ends.

## 2. Why the existing pieces don't cover it

- `fillEmptyTables` (Pass 1, runs first, currently gated OFF by `AUTO_OPEN_EMPTY_TABLES_ENABLED=false`): finds **active** empty tables and **immediately assigns** a currently-eligible dealer (available, or on_break passing rest guard) via `assign_dealer_to_table`. It does NOT wait for a still-resting dealer, and would either skip A (rest guard) or pull a different available dealer now. It never opens/activates new tables (verified: queries `status='active'` only). It sends a batch "Mở Bàn (N bàn)" message, no per-dealer DM.
- Pre-assign mechanism (`pre_assigned_attendance_id` on a `dealer_assignments` row, pre-announce Telegram, execute-at-T0): only targets tables that **already have a dealer** about to swing out. An empty table has no assignment row to attach `pre_assigned_attendance_id` to.
- `dealer_attendance.pre_assigned_table_id` + `current_state='pre_assigned'`: already exists and is honored by checkout-dealer / close-table (released on checkout/close). This is the natural anchor for "dealer pre-assigned to a (currently dealer-less) table".

## 3. Owner policy conflict (must resolve first)

`process-swing/index.ts:78-87` documents an owner policy (2026-06-13): the cron must **NEVER auto-staff an empty table** — staffing is manual-only via the "Gán"/"Gán loạt" buttons. This feature **reverses** that. Owner must explicitly sign off, and the policy comment + memory must be updated to the new policy.

Constraint that still holds: **never open/activate a NEW table** — only staff tables already `status='active'`.

## 4. Proposed behavior

Two phases, shipped separately.

### Phase A — fill empty active table when a dealer IS free (small)
- Flip `AUTO_OPEN_EMPTY_TABLES_ENABLED=true` (or a new dedicated flag `AUTO_STAFF_EMPTY_TABLES`).
- `fillEmptyTables` already: picks from available+break pool, rest-guarded, excludes assigned, open-table grace, batch "Mở Bàn" Telegram.
- Enhancement: also send a per-dealer incoming DM (`notifyIncomingDealer`) so the chosen dealer is told directly.
- Result: an empty open table is staffed within one tick **if any eligible dealer is free**.

### Phase B — predictive pre-assign of the soonest-free dealer (new logic)
For an empty active table where **no dealer is eligible right now** but one will be soon:
1. Find the soonest-free candidate = on_break dealer whose break ends earliest AND who will pass the rest guard by then (use `dealer_breaks.break_start + expected_duration` / meal-break end). Exclude already assigned/pre_assigned/in_transition.
2. **Pre-assign** them to the empty table:
   - Set `dealer_attendance.pre_assigned_table_id = table.id`, `current_state='pre_assigned'`, `pre_assigned_at=now()` for that dealer.
   - Represent the table side. Decision item (§6): either (a) create a `dealer_assignments` row with a not-yet-active status holding `pre_assigned_attendance_id`, or (b) track empty-table pre-assign purely on the attendance row and have the execute step create the assignment when the dealer frees up.
3. Send open-table Telegram with @mention + countdown ("📋 Mở bàn {table}: {@dealer} vào sau ~{n} phút").
4. On a later tick, when the dealer's break has ended and they pass the rest guard, **execute**: assign them to the table (`assign_dealer_to_table` with open-table grace so the swing clock starts on arrival) and clear the pre-assign marker.
5. If the dealer checks out / becomes unavailable before executing, release the pre-assign (mirror existing pre_assign cleanup, Pass 1c).

Ordering: both run as part of Pass 1 (before swing rotation), preserving "empty tables get priority".

## 5. Hard constraints (do not violate)
- Never open/activate a new table — only `status='active'` tables.
- Never pull a dealer who is `assigned`/`pre_assigned`/`in_transition`.
- Never pre-assign a dealer who won't pass the rest guard by arrival time.
- Don't yank a dealer off break early — wait for break end (that's the whole point vs immediate fill).
- Don't double-pre-assign one dealer to two tables, or two dealers to one table (idempotent + locking, reuse `assign_dealer_to_table` atomic outcomes).
- Manual "Gán"/"Gán loạt" must keep working unchanged.

## 6. Open design decisions (finalize at implementation)
- Empty-table pre-assign representation: new `dealer_assignments` pre_assigned row vs attendance-only marker. Prefer reusing whatever the execute path (`assign_dealer_to_table`) can consume cleanly; avoid a new migration if possible (DB changes are owner-gated separately).
- Dedicated flag (`AUTO_STAFF_EMPTY_TABLES`) vs reusing `AUTO_OPEN_EMPTY_TABLES_ENABLED`. A new, clearly-named flag is cleaner and decouples from the force-release policy.
- Tie-break when multiple empty tables compete for the same soonest-free dealer (highest blind first, matching fillEmptyTables sort).

## 7. Rollout & safety
- Phase A = controlled source-only PR (flag flip + per-dealer DM), `deno check`, owner-gated deploy (process-swing auto-deploys on push to main). Easy rollback = flip flag back.
- Phase B = separate controlled source-only PR after Phase A is verified live. No DB migration if achievable; if a column/RPC is needed, that's a separate owner-gated DB step.
- Verify each on a disposable/test table: open an empty table, confirm staffing / pre-assign + Telegram + countdown, confirm rest guard + no-new-table + no-yank.

## 8. Out of scope
Auto-opening/activating new tables; changing force-release policy; payroll; the 3 existing ghost rows (separate cleanup).
