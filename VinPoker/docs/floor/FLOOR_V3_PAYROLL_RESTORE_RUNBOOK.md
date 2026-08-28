# Floor V3 — Payroll/Telegram restore contract

This document is a source-only follow-up contract. It does not restore or apply
the held migrations and it does not authorize a production change.

## Preconditions

Restore is allowed only after the protected Floor V3 production deployment has
an owner-approved database receipt. The receipt must identify the exact Floor
migration versions and hashes that were applied. A Payroll/Telegram restore is a
separate owner-gated change and must not be included in the Floor promotion.

## Required sequence

1. Create fresh migration versions with `supabase migration new`; never reuse
   the held timestamps.
2. Port the byte-preserved SQL from
   `supabase/migration-archive/never-apply/` and review semantic equivalence
   against the archived SHA-256 values.
3. Run Payroll-specific disposable PostgreSQL tests, including grants,
   storage policy, idempotency and failure recovery. Do not apply to a live
   project during this step.
4. Deploy `render-payroll-statement` and `send-payroll-statement` only through
   their protected environment after the migration and Edge receipts are
   reviewed.
5. Complete authenticated Payroll UAT with TEST fixtures and exact-ID cleanup.
6. Promote or enable the Payroll surface only after the separate owner gate.

## Safety invariants

- The held sources remain absent from the active migration catalog until this
  sequence is complete.
- No Floor deployment may implicitly execute Payroll or Telegram SQL.
- No credential, service key or auth state belongs in this document or in CI
  logs/artifacts.
