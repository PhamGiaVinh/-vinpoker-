# Pending migrations

Post-production-head migrations remain outside the Floor V3 promotion catalog and are not active Supabase migrations.

- `20260924165219_centerpoint_tournament_ops_release_v1.sql` — shared default-OFF singleton gate and private server assertion/read helpers only. Source only; no TV or Satellite write path is gated yet. The integration migration must be ordered after the dependent consumer migrations, call the shared assertion at each server-side write boundary, and retain each consumer's actor/club authorization checks. Its disposable tests must cover the closed gate, non-allowlisted club, authorized and unauthorized actors while enabled, and unaffected tournament/Floor/Cashier writers.
- `20270113000007_tracker_voice_transcribe35_binding.sql` — Tracker Voice provider binding.
- `20270113000008_dealer_payroll_statement_telegram_delivery_contract_repair.sql` — Payroll Telegram delivery contract repair.
- `20270113000009_tracker_voice_board_atomic_commit_v0.sql` — Tracker Voice Board Assist atomic commit; source-only pending owner-gated rollout.
- `20270117000001_satellite_award_plan_v1.sql` — Satellite award-plan source only; needs ticket issuance/redemption, DB/RLS audit, TEST UAT and owner-gated promotion before use.
- `20270117000002_satellite_ticket_issue_v1.sql` — TD final-rank lock and private serialized ticket issuance; depends on award plan v1. Source only. Do not promote independently: source prize/overlay reconciliation and atomic Cashier voucher-funded registration + seat are not yet implemented. Requires disposable DB/RLS/concurrency tests and owner review.
- `20270118000002_satellite_single_ticket_rank_v2.sql` — closes the old multi-ticket-per-rank RPC, checks the stored plan, and exposes a single-ticket-per-rank writer. Source only; apply after award plan v1 in a controlled release, never by itself. This is not a funding or redemption implementation.
- `20270126000001_redraw_clock_hold_v1.sql` — source-only redraw hold/clock pause ownership and idempotent Continue RPC. Depends on `20260924165219_centerpoint_tournament_ops_release_v1.sql` and the applied floor redraw/seat-lock V1 schema; adds no live behavior until its pending migration is promoted. Requires PG17 transactional, race, retry, actor/club, and public-TV tests before promotion.
