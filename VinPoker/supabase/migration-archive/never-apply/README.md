# Never-apply migration sources

The versioned SQL files in this directory preserve source lineage but are not
part of the active `supabase/migrations` catalog. They must not be replayed by
a fresh Supabase Preview or applied by a production runbook.

## Containment metadata

| Original version | Filename | Original path | Archive path | Active replacement | Containment reason | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| 20270113000004 | 20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migrations/20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migration-archive/never-apply/20270113000004_floor_table_control_v3_contract_hardening.sql | supabase/migrations/20270113000005_floor_table_control_v3_contract_hardening.sql | The Floor source version collided with the separately merged dealer-payroll migration `20270113000004_dealer_payroll_statement_telegram_delivery.sql`. The archived payload is unchanged; the replacement is a new active catalog version for fresh Preview replay. | PREVIEW_REPLAY_UNSAFE_DUPLICATE_VERSION |

This is source-catalog containment only. It does not repair or modify a
database migration ledger, apply DDL, deploy Edge Functions, enable V3, alter
feature flags, or mutate business data.
