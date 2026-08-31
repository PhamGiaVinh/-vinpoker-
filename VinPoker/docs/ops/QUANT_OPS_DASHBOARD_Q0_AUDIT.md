---
title: Quant Ops Dashboard Q0 Audit
status: source-only-authority-hardening
updated: 2026-08-31
---

# Quant Ops Dashboard Q0 Audit

## Delivery boundary

Q0 extends the existing `/ops/select-module` Command Center. It adds no route,
writer, timer, Realtime subscription, Gemini call, model, forecast, score, or
money action. `opsQuantDataHealthQ0=false` is the source default, so the new
component does not mount and makes zero Q0 RPC calls until a separate rollout.

The two proposed RPCs are preserved under `supabase/pending-migrations/`.
They are not in the active migration catalog and have not been applied.

## Capability audit

| Source | Authority | Grain | Classification | Q0 availability | `asOf` | `observedAt` | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Club Pulse | `get_series_club_live_pulse_v1` | Club aggregate by metric definition | `OBSERVED` | Existing V1 | Server payload | Accepted-response receipt | Keep canonical headline |
| Live Operations | Existing client-injected readers | Club physical inventory plus active tournament links | `OBSERVED` | Existing V1; capacity semantics hardened in Q0 mode | Latest source timestamp when supplied | Accepted-response receipt | Board rows only for active `tournament_tables` links |
| Registration Pace | Proposed `get_ops_registration_pace_q0` | Club, event, confirmed-registration hour | `OBSERVED` | Contract source ready; DB not applied | Server receipt | Browser acceptance receipt | Eligible for DB contract review |
| SePay | Proposed `get_ops_sepay_read_state_q0` | Club, bank status, 24-hour ingest window | `DERIVED` | Contract source ready; DB not applied | Server receipt | Browser acceptance receipt | Eligible for DB contract review |
| Event Stream | No common approved append-only allowlist | Unknown | `OBSERVED` | `UNAVAILABLE` | None | Rendered source receipt | `BLOCKED_BY_EVENT_SOURCE` for this optional lane |
| Tài chính & Đối soát | Existing Finance RPC | Existing exact adapter range | `DERIVED` | Existing V1 | Source/range | Accepted-response receipt | Never aggregate with Digest |
| Daily Digest | Immutable digest artifact | Club report date | `DERIVED` | Existing V1 | Artifact time | Accepted-response receipt | Separate snapshot |
| Tracker | Existing rollout-gated reader | Running tournament alerts | `OBSERVED` | Existing V1 | Source when supplied | Accepted-response receipt | Zero call while `trackerVoiceInput=false` |

## Definitions

### Configured and open tables

- `configuredTableCount`: distinct physical `game_tables.id` rows in the
  verified club scope.
- `openTableCount`: distinct physical table IDs referenced by an active
  `tournament_tables` link for a running tournament.
- Board rows: only the active linked table IDs in Q0 mode. A club with 101
  configured tables and 4 active links renders `4 bàn đang mở · 101 bàn cấu
  hình`; it does not render 101 live rows.
- The table-to-tournament join remains the exact `tournament_tables` link.

### Registration observed count

- Window: tournaments starting from 24 hours before server `asOf` through 14
  days after it.
- `confirmedEntries`: exact count of `tournament_registrations.status =
  'confirmed'` for the event and club.
- `uniquePlayers`: exact `count(distinct player_id)` computed server-side;
  identities are never returned.
- `reentries`: exact count where the canonical `source_entry_id` is present.
- Timeline: hourly buckets from `confirmed_at`. A confirmed row without that
  timestamp makes only the timeline `PARTIAL`; counts remain observed facts.
- A `confirmed_at` after server `asOf` also makes the timeline `PARTIAL` with
  `FUTURE_CONFIRMED_AT`. Future timestamps are excluded from first/last,
  rolling windows, and timeline buckets while the status count remains an
  observed stored fact. This reason takes precedence over a missing timestamp.
- `last1h`, `last6h`, and `last24h` are deterministic filtered counts at the
  server receipt; `firstRegistrationAt` and `lastRegistrationAt` remain null
  when the source has no usable timestamp. Timeline buckets carry observed and
  cumulative counts, never an expected pace.
- The contract contains no forecast, nowcast, target, expected field, or
  recommendation.

### SePay states

The proposed read contract returns only state counts and known inbound VND sum.
It resolves active account numbers from `platform_bank_accounts` and treats an
exact, unique account-to-club mapping as authority. Stored
`bank_transactions.club_id` is an integrity signal, not the scoping source.

| Q0 state | Exact database expression |
| --- | --- |
| `actionable` | `bank_transactions.status = 'unmatched'` |
| `resolved` | status in `('matched','ignored')` |
| `quarantined` | status = `'quarantined'` |

Only `provider = 'sepay'` rows are eligible. The time grain is
`bank_transactions.created_at` in the inclusive prior 24 hours through server
`asOf`. If an
inbound row has no amount, the count remains exact but the bucket amount is
`PARTIAL` with `INBOUND_AMOUNT_MISSING`. The RPC never returns account number,
transaction/provider ID, content/memo, raw body/payload, customer identity, or
configuration. No SePay writer is imported or exported.

The read fails closed before aggregation when the requested club has no active
canonical account, an account maps to multiple clubs, another active SePay
configuration claims the same account, or any historical SePay row for that
account stores a different non-null club. The historical integrity probe is
bounded by the existing `(provider, account_number, provider_txn_id)` index.
These failures become stable sanitized reason codes in the browser; raw
PostgreSQL text is never rendered. An exact zero is returned only after all
authority checks pass.

Q0 does not invent a stale threshold. Source `asOf` and accepted-response
`observedAt` are shown separately; Q0 freshness remains `unknown` until a
reviewed per-source policy exists. Existing V1 `stale` states are preserved.

## Security model

- Browser code uses only the Ops-injected `useSupabaseClient()` context.
- Both pending RPCs require an authenticated actor and canonical
  `is_club_owner(actor, club)`; that helper includes Super Admin authority.
- Both readers pin an empty `search_path`, schema-qualify relations, revoke
  `PUBLIC`, `anon`, and `service_role`, and grant execute only to
  `authenticated`.
- The shared account resolver is `STABLE`, read-only, pins an empty
  `search_path`, and grants execution to no browser or service role. It is only
  invoked inside the owner-authorized SePay reader.
- Parsers reject unknown keys, malformed timestamps, unsafe integers,
  cross-club payloads, duplicate event/state identities, invalid count
  invariants, and raw sensitive fields.
- No table grant, DB apply, Edge deploy, or production mutation is in Q0.

## Truth layers

| Layer | State |
| --- | --- |
| SOURCE | Q0 contracts, parsers, UI, tests, and pending migration are in this Draft PR |
| DB CONTRACT SOURCE | Two additive RPC definitions under `pending-migrations` |
| DB APPLIED | No |
| FRONTEND FLAG | Source default `false` |
| PREVIEW UAT | Not run |
| PRODUCTION FRONTEND | Not changed by Q0 |
| OWNER UAT | Not run |

## Follow-up gates

1. Review the PostgreSQL 17 disposable authority and temporal proof.
2. Apply only through a separate owner-authorized DB wave.
3. Verify function ACLs, club isolation, and aggregate payloads live.
4. Open a separate narrow Preview flag-on PR and run authenticated owner UAT.
5. Event Stream remains unavailable until a bounded append-only allowlist is
   defined; raw `audit_logs` is not an acceptable shortcut.
