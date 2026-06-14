# GE-2 Online Poker — G4 Live Drill Harness

Tooling for the **owner-gated G4 live drill** (see `docs/engine/GE2_ENABLEMENT_RUNBOOK.md`).
Play-money, disposable data only. **Nothing here flips a flag.** While the runtime is
dark (`online_poker_config.enabled=false`) every Edge op returns `disabled`.

## Two execution paths

| Cases | Tool | Auth |
|---|---|---|
| disabled · idempotency replay · forbidden-seat · secrecy · chip-conservation **PASS** · play-to-showdown | `scripts/ge2-online-poker-drill.mjs` (Node, raw fetch) | 2 disposable test logins + anon key (env) |
| chip-conservation **FAIL** · race_lost · table setup/teardown · secrecy read | `scripts/ge2-drill/sql/*.sql` | operator's Management-API keyring token (service-role) |

The `.mjs` only reaches the Edge as a user (intent only). The adversarial cases need a
service-role `op_submit_action` with a crafted/stale state — clients can't call it — so
those are SQL run via the keyring helper.

## Setup (Phase D, owner-approved only)

1. Copy `scripts/.env.ge2-drill.example` → `scripts/.env.ge2-drill.local` (gitignored) and fill:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `P1_*`/`P2_*` (disposable logins).
2. **Enable** the runtime (super_admin): `UPDATE online_poker_config SET enabled=true;` — frontend flags stay OFF.
3. `01_setup_disposable_table.sql` → copy the returned id into `TABLE_ID`.
4. `node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs setup`
5. `node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs drill`
6. `02_chip_conservation_fail.sql`, `03_race_lost.sql`, `04_secrecy_read.sql` via the keyring helper.
7. Kill switch on any failure: `UPDATE online_poker_config SET enabled=false;`
8. `teardown` + `99_teardown.sql`; then re-assert `enabled=false`.

## Disabled rehearsal (safe while dark)

`node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs disabled-check`
→ unauthenticated 401, every op 403 `disabled`. Proves the harness + auth path work and
that nothing can act. Needs the two disposable logins; creates no data.
