# PL-PR2 — Payment Lifecycle Controlled Live Apply REPORT (2026-06-13)

**Operation:** apply_payroll_payment_lifecycle_pl1 (Supabase Ops Level 3)
**Target DB:** linked project `orlesggcjamwuknxwcpk`
**Applied object:** `supabase/migrations/20260819000005_payroll_payment_lifecycle_pl1.sql` (merged to main via PR #63 + rename PR #85)
**Rollback:** `docs/emergency_rollbacks/PL2_payment_lifecycle_apply_rollback_20260613.sql`

## Preflight (read-only)

- `20260819000005` NOT in schema_migrations · `20260819000004` (room-reconcile) present ✓
- `payment_records` absent · 3 PL RPCs absent · `chk_payroll_status` = 5-status
- `save_payroll_period` = B7 (md5 `65d547eb…`)
- club 11 fixture period `f96489c6` = draft, 2 dealers, Σ net 709,808 (server-computed B7)
- club 22 golden md5 `4a786968725b8879272ee701e576579b`

## Apply

One migration applied via Management API query (idempotent DDL; `schema_migrations` intentionally NOT touched — consistent with prior payroll controlled applies; migration is re-runnable under `db push` later).

Post-apply verify:
- `payment_records` table created ✓ · 3 RPCs present ✓
- `chk_payroll_status` now includes `payment_prepared`/`paid`/`reconciled` ✓
- `save_payroll_period` re-save guard extended to all payment states ✓
- `schema_migrations` unchanged (`20260819000005` not inserted) ✓
- club 22 golden md5 unchanged ✓

## UAT (club 11 fixture period f96489c6 only)

Actors: payer = vbacker `6c320d89` (club_admin), reconciler = athena `e7066175` (club_admin), no-role = `…000099`.

| # | Test | Result |
|---|---|---|
| NEG1 | prepare @ draft | PASS — "Expected status locked" |
| NEG2 | mark_paid @ draft | PASS — "Expected status payment_prepared" |
| NEG3 | reconcile @ draft | PASS — "Expected status paid" |
| NEG3b | reconcile @ payment_prepared | PASS — "Expected status paid" |
| NEG4 | prepare again @ payment_prepared | PASS — "Expected status locked" (status guard; unique index = 2nd layer) |
| NEG5 | mark_paid again @ paid | PASS — "Expected status payment_prepared" (double-pay blocked) |
| NEG6 | prepare by no-role actor | PASS — "is not authorized" |
| NEG8 | reconcile by payer (role separation) | PASS — "Reconciler must be different from the payer" |
| NEG9 | save_payroll_period @ paid | PASS — "locked or in payment lifecycle and cannot be modified" |
| POS | locked → prepare → paid → reconciled | PASS — full chain |

Positive end state: payment_record `reconciled`, `total_net_vnd`=709,808 (= Σ stored net, snapshot correct), `dealer_count`=2, `payment_ref`=UAT-PAY-001, `reconciliation_ref`=RECON-001, prepared_by/paid_by=vbacker, reconciled_by=athena; period columns + 3 audit rows (`PL1 prepare payment` / `PL1 mark paid` / `PL1 reconcile payment`) populated.

### Not executed live (documented)
- **NEG7 (cross-club cashier without link, not admin):** untestable with current population — all 3 users are `club_admin` (short-circuits the cashier branch); `user_roles.user_id` FKs `auth.users` so no synthetic cashier-only actor was created (avoids mutating auth). The club-link gate `(cashier AND EXISTS club_cashiers link)` is covered by code inspection; NEG6 already proves the final deny RAISE fires.
- **NEG5 payment_ref reuse across periods:** backed by `uq_payment_records_club_payment_ref`; needs a 2nd locked period in club 11 to exercise live — deferred (no fixture created).

## DB safety

```
schema_migrations changed: NO
deploy_db=true used:       NO
supabase db push used:     NO
golden fixture (club 22):  UNCHANGED
live objects added:        payment_records, 3 RPCs, constraint+columns, save guard (all from the reviewed migration)
test fixture club 11 f96489c6: now status=reconciled (designated UAT fixture; left as evidence)
```

## Next

PL-PR3 = frontend workflow UI (UIUX Phase 5 declaration; Prepare/Paid/Reconcile buttons + payment record display). THEN Owner Finance Dashboard. PL-PR4 (optional) = void/reverse, club-scoped admin, same-actor override flag.
