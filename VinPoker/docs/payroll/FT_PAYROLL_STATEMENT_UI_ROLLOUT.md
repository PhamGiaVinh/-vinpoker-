# FT Payroll Statement UI Rollout

Mode: `CRITICAL/RED`. This runbook does not authorize a production mutation by itself.

## Scope

- Full-time payroll statements only.
- Immutable server snapshot, PDF first-write state machine and per-dealer UI.
- No PT statement, Telegram, payout, bulk action or correction UI.
- Source-wide flag `payrollStatementPdfAllClubs` stays `false` through HSOP UAT.

## Source Safety

- Migration: `20270113000001_dealer_payroll_statement_ft_ui_contract.sql`.
- Runtime rollout row defaults to master OFF, all-clubs OFF and an empty allowlist.
- Outside the HSOP source canary, the existing client PDF path remains unchanged.
- In HSOP, a disabled or unavailable runtime gate locks the statement controls. It does not fall back to the client PDF path.

## Controlled Rollout

1. Record the exact reviewed merge SHA. Confirm Vercel Git auto-deploy is disabled.
2. Run protected catalog preflight for the current statement/PDF/storage contract.
3. Apply only the migration named above in an owner-approved database window. Do not use `db push` or migration replay.
4. Verify relations, columns, unique business index, exact RPC signatures, ACL/RLS and rollout defaults.
5. Run the target-aware positive contract probe.
6. Deploy only `render-payroll-statement` from the exact merge SHA through the protected workflow.
7. Deploy the frontend from the same exact merge SHA, still dark.
8. With master OFF, verify rollout=false and that draft preview, finalization, finalized preview, PDF generation and new signed URLs are all blocked.
9. Enable master and allowlist only HSOP (`22222222-2222-2222-2222-222222222222`). Keep all-clubs OFF.
10. UAT a locked TEST period: draft preview, double-click finalize, lost-response reconciliation, hard refresh, two-tab PDF generation, READY retry and signed URL expiry.
11. Verify no payout/payment row changed.
12. Set master OFF once and repeat the negative checks. Re-enable HSOP only after the owner accepts that evidence.
13. Monitor RPC, Edge, Storage and payroll audit evidence for at least 15 minutes.

## Incident Containment

- Set runtime master OFF. Do not wait for a frontend redeploy.
- Do not delete or overwrite a statement, PDF object or audit row.
- Do not issue a payout from a disputed statement.
- Record statement ID, actor, club, period, statement hash and relevant sanitized receipts.

## Accidental Finalization

The current slice intentionally has no correction UI.

1. Disable rollout if the incident may continue.
2. Preserve the immutable statement and any generated PDF.
3. Do not edit the snapshot and do not replace the Storage object.
4. Use only an owner-approved backend void/replacement procedure or a later correction PR.
5. Keep the original and replacement lineage visible in audit evidence.

## Rollback

- Runtime rollback is master OFF.
- Edge rollback uses the exact verified prior deployment receipt, never a guessed version number.
- Schema rollback, if ever required, must be a new forward migration. The existing statement/PDF/audit evidence remains immutable.
