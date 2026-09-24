# Pending migrations

Post-production-head migrations remain outside the Floor V3 promotion catalog and are not active Supabase migrations.

- `20270113000007_tracker_voice_transcribe35_binding.sql` — Tracker Voice provider binding.
- `20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair.sql` — Payroll Telegram delivery contract repair.
- `20270113000009_tracker_voice_board_atomic_commit_v0.sql` — Tracker Voice Board Assist atomic commit; source-only pending owner-gated rollout.
- `20270117000001_satellite_award_plan_v1.sql` — Satellite award-plan source only; needs ticket issuance/redemption, DB/RLS audit, TEST UAT and owner-gated promotion before use.
- `20270117000002_satellite_ticket_issue_v1.sql` — TD final-rank lock and private serialized ticket issuance; depends on award plan v1. Source only. Do not promote independently: migration 03 must gate source funding before any issuance.
- `20270117000003_satellite_ticket_funding_v1.sql` — owner-locked source confirmed-registration gross, Satellite entry fees, buy-in pool, full-price ticket liability, cash awards, explicit overlay and remaining balance. Adds a server-side issuance gate. Depends on 01-02 and a reconciled Satellite close report. **Not yet sufficient evidence of money actually received:** per-registration payment source/owner policy still needs to be finalized before promotion.
- `20270117000004_satellite_ticket_redeem_v1.sql` — Cashier lookup/redeem, target registration and seat in one transaction, immutable source-to-target voucher transfer, worklist/close preview, and target close-report split of internal transfer from non-voucher registrations. Depends on 01-03 **and** `20270115000000_cashier_tour_money_v1.sql` (Cashier V2). Verify its live DB state separately; source integration is not proof of deployment.
- `20270117000005_satellite_ticket_code_rotation_v1.sql` — owner-only replacement of a lost/misprinted private code. Keeps the same serial, ticket and prize liability; invalidates the old code and stores an immutable private rotation trail. Depends on 02-03.

All Satellite migrations remain source-only with flags OFF. The GTD-ticket rule (minimum 4/6 tickets, additional tickets as entries grow, next-rank cash remainder, one ticket per rank) is not yet enforced by 01-02; do not promote this draft. Disposable DB verification order: Cashier V2 baseline/tests, Satellite 01 and its test, 02 and its test, 03 and its test, 04 and its test, then 05 and its test. Test concurrency/retry and RLS separately before owner UAT. Do not apply 02 alone or enable the UI before source payment verification, GTD rules, DB/RLS audit, and controlled promotion. These SQL tests have not been run on a disposable DB yet.
