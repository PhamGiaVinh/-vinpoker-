# Floor V3 — Payroll/Telegram lineage reconciliation contract

This document is a source-only follow-up contract. It does not restore or apply
the archived migrations and it does not authorize a production change. The
archived SQL is historical preservation, not an instruction to replay work that
may already exist in Production under an alias or an unknown ledger provenance.

## Preconditions

Any Payroll/Telegram change is allowed only after the live contract has been
audited and the protected Floor V3 deployment has an owner-approved database
receipt. The receipt must identify the exact Floor migration versions and hashes
that were applied. Payroll/Telegram is a separate owner-gated change and must
not be included in the Floor promotion.

## Floor promotion dry-run receipt

The Floor promotion guard distinguishes historical ledger gaps from the
executable migration plan. Before a production runbook is considered, capture
the supported read-only plan against the linked project:

```powershell
supabase db push --linked --dry-run --output-format json
```

Do not add `--include-all`, `--include-seed`, `--yes`, or a migration repair
command. Store only a sanitized receipt with `commandMode=dry-run`,
`includeAll=false`, the safe project ref, and the ordered migration filenames.
Validate it with:

```powershell
npm run check:migration-promotion -- --ledger <ledger.json> --push-plan <receipt.json> --json
```

The guard requires exact equality with the four Floor filenames. A missing
database credential or a CLI connection error is a blocker; it is not evidence
that historical ledger gaps will be executed.

## Required sequence

1. Inspect the live schema, function signatures, storage contract, rollout
   state, Edge receipt and migration ledger name/version before writing SQL.
2. Treat the archived source as `DO_NOT_REPLAY`; never replay the exact SQL
   merely because its original version is absent from the ledger.
3. If an actual delta is proven, create a fresh migration with
   `supabase migration new`; never reuse the held timestamps. Document the
   delta and why it is not already present.
4. Run Payroll-specific disposable PostgreSQL tests, including grants, storage
   policy, idempotency and failure recovery. Do not apply to a live project
   during this step.
5. Deploy `render-payroll-statement` and `send-payroll-statement` only through
   their protected environment after the migration and Edge receipts are
   reviewed.
6. Complete authenticated Payroll UAT with TEST fixtures and exact-ID cleanup.
7. Promote or enable the Payroll surface only after the separate owner gate.

## Safety invariants

- The archived sources remain absent from the active migration catalog and are
  not automatically reintroduced.
- No Floor deployment may implicitly execute Payroll or Telegram SQL.
- Migration-history repair is never implicit; any repair requires a separate
  owner-approved runbook.
- No credential, service key or auth state belongs in this document or in CI
  logs/artifacts.
