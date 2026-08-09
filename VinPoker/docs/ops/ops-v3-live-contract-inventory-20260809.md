# Ops V3 live contract inventory — 2026-08-09

## Safety boundary

- Source baseline: `d47a6afa40e0fa989d31614fe9771fbf87e41dd0` (`origin/main`).
- Production project checked: project ref `orlesggcjamwuknxwcpk` (names-only evidence).
- Method: read-only PostgreSQL catalog and migration-ledger queries.
- No business rows, credential values, DB writes, Edge deploys, flag changes or production workflow dispatches were used.

## Migration ledger

- Exact version `20270109000000` is present live as `ops_floor_cashier_canonical_mutations`.
- A prior ledger row `20260809004151` has the same logical migration name. This is recorded as lineage evidence only; no ledger edit is part of Ops V3.
- Result: no `20270109000000` reconciliation prerequisite is required for PR 1A.

## Membership dependencies

| Capability | Canonical live source | Shape | RLS | Gate 0 |
|---|---|---|---|---|
| Floor | `club_floors` | PK `(club_id,user_id)`, club/user FKs | ON | PASS |
| Cashier | `club_cashiers` | PK `(club_id,user_id)`, club FK | ON | PASS |
| Tracker | `club_trackers` | PK `(club_id,user_id)`, club/grantor FKs | ON | PASS |
| Dealer Control | `club_dealer_controls` | PK `(club_id,user_id)`, club FK | ON | PASS |
| Accountant | `club_accountants` | PK `id`, unique `(club_id,user_id)`, club/user FKs | ON | PASS |
| Chip Master | `club_chip_masters` | PK `(club_id,user_id)`, club/user FKs | ON | PASS |
| Marketing | `club_marketers` | PK `(club_id,user_id)`, club/user FKs | ON | PASS |
| F&B | `club_fnb_staff` | PK `(club_id,user_id,kind)`, enum facets `cashier/server/kitchen` | ON | PASS |

`clubs.owner_id`, `user_roles.role`, `app_role.super_admin`, `auth.uid()` and `has_role(uuid,app_role)` also exist live.

## Existing helper posture

The existing Floor scope is caller-bound and correctly exposes Owner/Floor/Cashier. Several older helpers accept a caller-supplied user UUID; some retain `PUBLIC`/`anon` execute ACL or `search_path=public`. PR 1A does not reuse those helpers and does not broaden their reach. The new functions:

- accept no user UUID;
- derive the actor from `auth.uid()`;
- use fully qualified objects with `search_path=''`;
- revoke `PUBLIC`, `anon` and `service_role`;
- grant only `authenticated`.

Legacy helper/table ACL normalization is a separate security-hardening scope because changing it can affect deployed legacy consumers.

## Raw capability semantics

- `can_owner` means a direct `clubs.owner_id` match.
- Other `can_*` fields mean a direct row in the canonical membership table.
- Owner and Super Admin inheritance is not written as a fake membership.
- `is_super_admin` is returned by a separate global RPC.
- Super Admin login does not enumerate every club; the club selector uses a bounded search/cursor RPC.

## Conservative module required-contract matrix

| Module | Required contracts before `LIVE` | Initial runtime state for V3 |
|---|---|---|
| Club Admin | capability RPC, operator invite RPCs, authenticated invite UAT | `LIVE` only for the already-UAT invite surface |
| Floor | Floor scope/RPC set, table/seat/clock/draw/bust/restore contracts, browser matrix | existing verified surface only |
| Cashier | cashier scope, canonical reads, Gate B ACL proof | `READ_ONLY` |
| Tracker | tracker membership, exact writer-lock/concurrency proof, Ops-session adapter | `READ_ONLY`/`BLOCKED` writers |
| Dealer Swing | dealer-control membership, Ops-session adapter, payroll split, parity UAT | `READ_ONLY` |
| F&B | three membership facets, route-specific reads, money/stock authority UAT | `DISABLED` |
| Marketing | marketer membership, channel contract, external-send UAT | `DISABLED` |
| Chip Ops | chip-master membership, typed RPC adapters, stale/idempotency UAT | `READ_ONLY` |
| Tài chính & Đối soát | `get_club_finance_summary`, RPC-only error behavior, authenticated read UAT | `READ_ONLY` or `BLOCKED` on RPC error |
| Kế toán vận hành | accountant membership, payroll authority remediation, write UAT | `BLOCKED` |
| Series | Owner/Super capability, exact feature/runtime receipt, Ops local-state namespace | `READ_ONLY` |
| Accounting Control legacy | real non-mock server contracts | `BLOCKED`; no mock rendering |

This inventory is evidence for source design only. It does not claim that any new Ops V3 RPC is live.
