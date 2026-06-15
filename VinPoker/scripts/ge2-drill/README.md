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

## Load / capacity test (PR B)

Capacity target: **9-handed** tables; **1 → 3 → 10 → 30** concurrent tables (≈180–270 seated).
There are **two** load surfaces:

**1. In-process engine simulator — runnable NOW, no DB/Edge/flag** (the safe "dry mode"):
```
cd VinPoker && npx vitest run tests/onlinePoker/loadSim.test.ts
```
Spins up 1/3/10/30 independent 9-seat tables, plays random legal lines, and asserts after
every action/hand: chip conservation, no negative stack/pot, hand completion (no stuck),
no public-wire leak (`holeCards`/`deck`), **table isolation** (one table's fault never aborts
the others), plus out-of-turn rejection and engine purity. 9-handed engine fixtures live in
`tests/pokerEngine/ninehanded.test.ts`; the property test (`invariants.test.ts`) now covers
2–9 seats. This validates the **engine** at the capacity target.

**2. Live multi-table throughput — Phase D only (NOT in this PR).** Driving the real Edge
across 30 tables × 9 seats needs ~270 authenticated bot logins (or a service-role bot driver)
and `online_poker_config.enabled=true`. That is an owner-gated Phase-D exercise; design it as
a `loadtest` extension of `ge2-online-poker-drill.mjs` once Phase D is open. The in-process
simulator above is the pre-Phase-D evidence; the live run measures real Edge latency + Supabase
Realtime fanout (the two MEDIUM capacity risks in the readiness research).

> ⚠️ **Known gap → next PR C (not fixed here): `op_timeout_sweep` is unwired.** No cron/scheduler
> calls it, so a disconnected/AFK player can stall a table indefinitely. The load simulator does
> not model wall-clock timeouts. Wiring the timeout sweep (server-authoritative auto-fold /
> sit-out) is the recommended **PR C — timeout-sweep hardening (source-only)**.
