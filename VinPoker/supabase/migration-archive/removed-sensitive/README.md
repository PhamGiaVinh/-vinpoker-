# Removed replay-unsafe migration sources

The versioned SQL files listed below were deliberately removed from the active
`supabase/migrations` catalog. The original set embedded a credential-like
client JWT and scheduled HTTP calls to the production project. The catalog also
contains one mixed historical migration that attempted ownership-requiring DDL
against Supabase Realtime's managed relation. Git-managed Preview builds must
not replay either class of source.

The credential-bearing SQL payloads are intentionally **not** copied into this
archive. Do not restore them into the active catalog or recover their
credential literals from Git history. Any future scheduler or trigger must be
introduced as a new, owner-gated migration that reads its target and
authorization only from the runtime environment, uses a non-production Preview
target, and passes Preview UAT before a controlled production rollout.

Retired source versions:

- `20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql`
- `20260530000004_pg_cron_auto_swing.sql`
- `20260603000002_fix_cron_schedule.sql`
- `20260607192552_fix_backup_cron_hardcoded_auth.sql`
- `20260607191236_schedule_run_dealer_ready_backup_cron.sql`
- `20260607203059_schedule_process_pre_announce_jobs_cron.sql`
- `20261101000003_schedule_marketing_dispatch.sql`
- `20261101000008_schedule_marketing_autocontent.sql`

- `20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql`

The 20260429060607 source had no credential literal. Its unchanged historical
payload is archived at
`supabase/migration-archive/removed-sensitive/20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql`.
The active replacement
`supabase/migrations/20260429060607_preview_safe_profiles_clubs_storage_audit.sql`
keeps the original migration version and retains only the public, storage, and
audit-column contracts. It deliberately excludes all `realtime.messages` DDL.

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

## Containment metadata

| Original version | Filename | Original path | Archive or contained path | Containment reason | Classification |
| --- | --- | --- | --- | --- | --- |
| 20260428144425 | 20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql | supabase/migrations/20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20260429060607 | 20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql | supabase/migrations/20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql | supabase/migration-archive/removed-sensitive/20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql; replacement: supabase/migrations/20260429060607_preview_safe_profiles_clubs_storage_audit.sql | ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY requires managed-relation ownership | PREVIEW_REPLAY_UNSAFE_MANAGED_SCHEMA_DDL |
| 20260530000004 | 20260530000004_pg_cron_auto_swing.sql | supabase/migrations/20260530000004_pg_cron_auto_swing.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20260603000002 | 20260603000002_fix_cron_schedule.sql | supabase/migrations/20260603000002_fix_cron_schedule.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20260607191236 | 20260607191236_schedule_run_dealer_ready_backup_cron.sql | supabase/migrations/20260607191236_schedule_run_dealer_ready_backup_cron.sql | supabase/migration-archive/removed-sensitive/README.md | Production-targeted scheduler | PREVIEW_REPLAY_UNSAFE_PRODUCTION_SCHEDULER |
| 20260607192552 | 20260607192552_fix_backup_cron_hardcoded_auth.sql | supabase/migrations/20260607192552_fix_backup_cron_hardcoded_auth.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20260607203059 | 20260607203059_schedule_process_pre_announce_jobs_cron.sql | supabase/migrations/20260607203059_schedule_process_pre_announce_jobs_cron.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20261101000003 | 20261101000003_schedule_marketing_dispatch.sql | supabase/migrations/20261101000003_schedule_marketing_dispatch.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20261101000008 | 20261101000008_schedule_marketing_autocontent.sql | supabase/migrations/20261101000008_schedule_marketing_autocontent.sql | supabase/migration-archive/removed-sensitive/README.md | Credential-like client JWT and production HTTP target | PREVIEW_REPLAY_UNSAFE_CREDENTIAL_HTTP |
| 20260516123400 | 20260516123400_push_notification_dispatch.sql | supabase/migrations/20260516123400_push_notification_dispatch.sql | supabase/migrations/20260516123400_push_notification_dispatch.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |
| 20260525000001 | 20260525000001_schedule_enforce_break_balance.sql | supabase/migrations/20260525000001_schedule_enforce_break_balance.sql | supabase/migrations/20260525000001_schedule_enforce_break_balance.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |
| 20260607191545 | 20260607191545_fix_notify_dealer_ready_v2_auth.sql | supabase/migrations/20260607191545_fix_notify_dealer_ready_v2_auth.sql | supabase/migrations/20260607191545_fix_notify_dealer_ready_v2_auth.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |
| 20260609000018 | 20260609000018_notify_dealer_ready_v2.sql | supabase/migrations/20260609000018_notify_dealer_ready_v2.sql | supabase/migrations/20260609000018_notify_dealer_ready_v2.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |
| 20260701000013 | 20260701000013_deadlock_recovery_schema.sql | supabase/migrations/20260701000013_deadlock_recovery_schema.sql | supabase/migrations/20260701000013_deadlock_recovery_schema.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |
| 20261115000000 | 20261115000000_sepay_reconcile.sql | supabase/migrations/20261115000000_sepay_reconcile.sql | supabase/migrations/20261115000000_sepay_reconcile.sql | Active scheduler-free bootstrap retains schema/trigger contract | PREVIEW_REPLAY_CONTAINED_HTTP_BOOTSTRAP |

This contained catalog is for isolated Preview validation only. It is not an
immutable production replay runbook and must not be applied to production by
automation.
