# Removed credential-bearing migration sources

The versioned SQL files listed below were deliberately removed from the active
`supabase/migrations` catalog. They embedded a credential-like client JWT and
scheduled HTTP calls to the production project, so Git-managed Preview builds
could replay a production-targeted side effect.

The SQL payloads are intentionally **not** copied into this archive. Do not
restore them into the active catalog or recover their credential literals from
Git history. Any future scheduler or trigger must be introduced as a new,
owner-gated migration that reads its target and authorization only from the
runtime environment, uses a non-production Preview target, and passes Preview
UAT before a controlled production rollout.

Retired source versions:

- `20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql`
- `20260530000004_pg_cron_auto_swing.sql`
- `20260603000002_fix_cron_schedule.sql`
- `20260607192552_fix_backup_cron_hardcoded_auth.sql`
- `20260607191236_schedule_run_dealer_ready_backup_cron.sql`
- `20260607203059_schedule_process_pre_announce_jobs_cron.sql`
- `20261101000003_schedule_marketing_dispatch.sql`
- `20261101000008_schedule_marketing_autocontent.sql`

This is a source-catalog containment only. It does not change a database,
deployment, Edge Function, feature flag, scheduler, money path, or data.

Six historical migration filenames remain active because later source needs
their schema, service-only RPC, or trigger signatures. Their contained
implementation is now a deliberate no-op or scheduler-free bootstrap without
a fixed target, credential, or HTTP side effect:

- `20260516123400_push_notification_dispatch.sql`
- `20260525000001_schedule_enforce_break_balance.sql`
- `20260607191545_fix_notify_dealer_ready_v2_auth.sql`
- `20260609000018_notify_dealer_ready_v2.sql`
- `20260701000013_deadlock_recovery_schema.sql`
- `20261115000000_sepay_reconcile.sql`

This contained catalog is for isolated Preview validation only. It is not an
immutable production replay runbook and must not be applied to production by
automation.
