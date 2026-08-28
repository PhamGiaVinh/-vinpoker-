# Never-apply migration sources

The versioned SQL files in this directory preserve source lineage but are not
part of the active `supabase/migrations` catalog. They must not be replayed by
a fresh Supabase Preview or applied by a production runbook.

## Containment metadata

| Original version | Filename | Original path | Archive path | Active replacement | Containment reason | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| 20270113000004 | 20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migrations/20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migration-archive/never-apply/20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migrations/20270113000005_floor_table_control_v3_contract_hardening.sql | The Floor source version collided with the separately merged dealer-payroll migration `20270113000004_dealer_payroll_statement_telegram_delivery.sql`. The archived payload is unchanged; the replacement is a new active catalog version for fresh Preview replay. | PREVIEW_REPLAY_UNSAFE_DUPLICATE_VERSION |
| 20270113000000 | 20270113000000_dealer_payroll_statement_pdf_storage.sql | supabase/migrations/20270113000000_dealer_payroll_statement_pdf_storage.sql | supabase/migration-archive/never-apply/20270113000000_dealer_payroll_statement_pdf_storage.sql | NOT_YET_CREATED | Production and persistent Preview ledgers contain no applied receipt for this Payroll migration. It is held so the next Floor-only promotion cannot implicitly execute Payroll storage/schema work. Restore only with a separate Payroll runbook and fresh migration version after a Floor production receipt. | MIGRATION_PROMOTION_HELD_UNAPPLIED_PAYROLL |
| 20270113000001 | 20270113000001_dealer_payroll_statement_ft_ui_contract.sql | supabase/migrations/20270113000001_dealer_payroll_statement_ft_ui_contract.sql | supabase/migration-archive/never-apply/20270113000001_dealer_payroll_statement_ft_ui_contract.sql | NOT_YET_CREATED | Production and persistent Preview ledgers contain no applied receipt for this Payroll migration. It is held so the next Floor-only promotion cannot implicitly execute Payroll statement work. Restore only with a separate Payroll runbook and fresh migration version after a Floor production receipt. | MIGRATION_PROMOTION_HELD_UNAPPLIED_PAYROLL |
| 20270113000004 | 20270113000004_dealer_payroll_statement_telegram_delivery.sql | supabase/migrations/20270113000004_dealer_payroll_statement_telegram_delivery.sql | supabase/migration-archive/never-apply/20270113000004_dealer_payroll_statement_telegram_delivery.sql | NOT_YET_CREATED | Production and persistent Preview ledgers contain no applied receipt for this Payroll/Telegram migration. It is held so the next Floor-only promotion cannot implicitly execute Telegram delivery work. Restore only with a separate Payroll/Telegram runbook and fresh migration version after a Floor production receipt. | MIGRATION_PROMOTION_HELD_UNAPPLIED_PAYROLL_TELEGRAM |

This is source-catalog containment only. It does not repair or modify a
database migration ledger, apply DDL, deploy Edge Functions, enable V3, alter
feature flags, or mutate business data.
