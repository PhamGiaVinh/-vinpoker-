# Ops Intelligence Wave 3 Evidence

## Identity

- Base SHA: `7a64098e03af11c8dbe32ff5ef8c42ff2c2bd0b8`
- Branch: `codex/intelligence-wave3-operational-timeline`
- Head SHA: the immutable Draft PR head containing this document; recorded in the PR and final delivery report.
- Scope: source and disposable-test assets only. No production apply, deploy, flag change, Edge change, Gemini call, or business-data write.

## Metric Definitions

| Metric | Definition | Truth boundary |
|---|---|---|
| Active seated entries | One entry from `seated_at` until `busted_at` | Counts entries, not unique players. Invalid or incomplete terminal lifecycle timestamps make the source partial. |
| Open tournament tables | Exact tournament `table_sessions` from `opened_at` until `closed_at` | Does not infer history from current table status. |
| Open seat capacity | Sum of exact `tournament_tables.max_seats` bindings for active sessions | Any missing or ambiguous binding makes capacity partial and null. |
| Assigned dealer coverage | Number of exact tournament table sessions covered by the union of their dealer assignment intervals | Overlapping or touching handover rows for one session remain one covered session. Unbound relevant assignments make dealer truth partial. |
| Dealer gap | `max(0, open tables - assigned dealers)` | Emitted only when both source series are exact; no reason is inferred. |
| Confirmed prize contribution | Cumulative confirmed registration `buy_in` at `confirmed_at` | Zero buy-in is retained. Missing/future confirmation timestamps make the timeline partial. |
| GTD coverage | Confirmed contribution compared with canonical `guarantee_amount` | Null GTD is unavailable; zero GTD is `NO_GUARANTEE`; not revenue or profit. |

## Server Contract

- Pending function: `public.get_ops_intelligence_timeline_v1(uuid, uuid)`.
- Sources: `tournament_entries`, `table_sessions`, `tournament_tables`, `dealer_assignments`, `tournament_registrations`, and `tournaments`.
- Authorization: authenticated actor, server-side club ownership/canonical super-admin check, exact tournament-to-club match, empty `search_path`, no `PUBLIC` or `anon` execute grant.
- Privacy: aggregate counts and timestamps only; no player, member, registration, attendance, dealer, or seat identity is returned.
- Network: one client-injected React Query reader for one exact tournament. Festival/club scope sends no timeline request. No polling, Realtime, Edge, or Gemini call.

## Quality Rules

- `null` and exact zero remain distinct.
- Exact empty sets may present zero summaries without inventing historical points.
- Partial dealer binding never emits a dealer-shortage claim.
- Entry, table, dealer, and GTD deltas sharing one timestamp are grouped before cumulative sums, so handovers do not create transient false values.
- A terminal `finished`/`cancelled` entry without an exact terminal timestamp degrades occupancy to partial rather than remaining active forever.
- Step charts use source event-change timestamps and do not interpolate or add a forecast tail.
- Festival scope lists exact Flight/Final children and never aggregates tournament timelines at the parent.

## Validation

- Focused Wave 1/2/3 plus Ops auth: `165/165` tests passed across `19/19` files.
- Wave 3 focused boundary tests: `12/12` passed after lifecycle/GTD hardening.
- Ops boundary: pass (`152` files).
- Ops money boundary: pass.
- Owner digest read boundary: pass.
- Ops V3 shell text guard: pass.
- Sensitive credential context guard: pass.
- Focused TypeScript (`tsconfig.ops-v3-finance-series.json`): pass.
- Targeted ESLint: pass.
- Normal production build: pass.
- Constrained production build (`NODE_OPTIONS=--max-old-space-size=3072`, `GOMAXPROCS=2`): pass.
- Route-mock E2E: `19/19` passed, including exact and partial Wave 3 paths, desktop and fallback viewports, no page/console errors, and no horizontal overflow.
- Current `origin/main` after final verification: `28b1fcd98485a88cbb32e5c165a9b3c870c3d4de`; its post-base change is unrelated Tracker work and was not folded into this Draft PR.

## PG17

- Disposable script: `tests/ops/intelligenceTimeline.disposable.sql`.
- Runtime: PostgreSQL `17.11`, temporary cluster bound only to loopback on high port `55493`, disposable database `wave3_timeline_disposable_1234`.
- Migration apply and reapply: pass. The exact pending migration executed twice with `ON_ERROR_STOP=1`; `CREATE OR REPLACE` remained idempotent and exactly one `(uuid, uuid)` overload existed.
- Function execution: pass. The fixture called `get_ops_intelligence_timeline_v1(uuid, uuid)` for exact, partial, empty, temporal-handoff, owner, anonymous, super-admin, and cross-club cases.
- ACL/security posture: pass. `SECURITY DEFINER`, `STABLE`, empty `search_path`, no `PUBLIC`/`anon` execute, and authenticated execute were verified from PG17 catalogs. The function body remains aggregate read-only.
- Temporal deltas: pass. Occupancy, table, and dealer handoffs at identical timestamps remained `1`; two registrations at the same timestamp produced one cumulative GTD point of `300`.
- Dealer coverage: pass. Overlapping assignments on one exact table session never exceeded coverage `1`; a relevant unbound assignment produced `partial`, `DEALER_SESSION_BINDING_INCOMPLETE`, no points, and no dealer gap.
- Capacity: pass. Exact bindings retained positive seat capacity; a non-positive binding produced partial capacity and JSON `null`, not zero.
- GTD parity: pass. The terminal timeline value equaled `get_tournament_prize_pool.prize_pool` for the same tournament, while zero buy-in, surplus, null GTD, and missing `confirmed_at` remained distinct.
- Cross-club/privacy: pass. Owner cross-club and tournament/club mismatch were denied; super-admin exact access passed; aggregate JSON contained no fixture player/dealer identity.
- Plan probe: `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` completed in `3.658 ms` on the small fixture (`31` shared-buffer hits). This is not a production performance claim and does not justify a speculative index.
- Disposable cluster and database were local test infrastructure only; no Supabase production connection was used.

## Screenshots

- `docs/ops/evidence/wave3/wave3-daily-timeline-1440x900.png`
- `docs/ops/evidence/wave3/wave3-partial-source-1440x900.png`

## Source And Production

- Source: implemented on the branch above; Draft PR is the review boundary.
- Production: unchanged. The pending function has not been applied and the frontend has not been deployed.
- Rollback: revert the source PR. If the pending function is later applied under a separate owner gate, drop only `public.get_ops_intelligence_timeline_v1(uuid, uuid)` under that controlled rollback.

## Not Measured

- Full `tsc -b`: `NOT_MEASURED`; the earlier bounded 90-second run produced no result and was stopped. Focused TypeScript passed after the final SQL/parser correction.
- Production migration, production frontend, and authenticated production UAT were not performed in this source-only gate.
