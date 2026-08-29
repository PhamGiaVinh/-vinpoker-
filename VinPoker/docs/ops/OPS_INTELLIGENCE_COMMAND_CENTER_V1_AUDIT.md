---
title: Ops Intelligence Command Center V1 Audit
status: source-only
updated: 2026-08-29
---

# Ops Intelligence Command Center V1 Audit

## Scope and authority

This V1 is a read-only Owner/Super Admin surface inside `/ops/select-module`.
It does not create a route, write a record, subscribe to Realtime, poll, call
an Edge Function, or make a financial decision. The parent flag remains
`opsIntelligenceCommandCenterV1=true` in current source. This audit does not
claim the current production bundle or authenticated runtime without a
deployment receipt and UAT evidence from the corresponding rollout.

The `OpsIntelligenceEntryGate` resolves a trusted club before any intelligence
reader mounts. A non-superadmin may select only a caller-bound `can_owner`
club. A Super Admin query parameter is only a request until
`verifySuperAdminClub()` accepts it.

## Metric and source matrix

| Surface | Source contract | Grain and authority | `asOf` / receipt | V1 state |
| --- | --- | --- | --- | --- |
| Entries today | `get_series_club_live_pulse_v1` / `entries_today` | Canonical Club Pulse aggregate, club event-start local calendar day | Server `asOf`; accepted-response `observedAt` | Eligible headline KPI |
| Players playing now | Club Pulse / `players_playing_now` | Canonical Club Pulse aggregate, live tournaments | Server `asOf`; accepted-response receipt | Eligible headline KPI |
| Running events | Club Pulse / `running_events` | Canonical Club Pulse aggregate, live tournaments | Server `asOf`; accepted-response receipt | Eligible headline KPI |
| Open tables | Club Pulse / `open_tables` | Canonical Club Pulse aggregate, club tournament tables | Server `asOf`; accepted-response receipt | Eligible headline KPI |
| Dealers on duty | Club Pulse / `dealers_on_duty` | Canonical Club Pulse aggregate, current attendance | Server `asOf`; accepted-response receipt | Eligible headline KPI |
| Operations Board | `tournament_tables` plus tournament, assignment and attendance reads | Entity detail only; it does not replace Club Pulse totals | Latest source timestamp when available; accepted-response receipt | V1 legacy view; Q0 mode separates configured inventory from active linked rows |
| Dealer rotation overdue | Canonical `dealerSwingState` derivation | Existing Dealer Swing timing/state semantics only | Assignment source / accepted-response receipt | Eligible alert; no new threshold |
| Tài chính & Đối soát | `get_club_finance_summary` | Server aggregate for the adapter's exact UTC `from`/`to` range | Adapter range plus accepted-response receipt | Eligible panel; never added to Digest |
| Daily Digest | `get_latest_owner_daily_digest_artifact` | Immutable daily snapshot, with its own money/freshness states | Artifact `generatedAt`; accepted-response receipt | Eligible separate panel; empty response is `EMPTY EXACT` |
| Tracker alerts | Shared read loader | Read-only alert count for running tournaments | Accepted-response receipt | Eligible only when `trackerVoiceInput=true`; otherwise zero RPC/subscription |
| Registration pace | Pending `get_ops_registration_pace_q0` contract | Club/event/hour; confirmed registrations only | Server `asOf`; accepted-response receipt | Q0 source ready, DB not applied |
| SePay | Pending `get_ops_sepay_read_state_q0` contract | Sanitized club/status/24-hour aggregate | Server `asOf`; accepted-response receipt | Q0 source ready, DB not applied |
| Event stream | No approved common append-only allowlist | Unknown | N/A | Q0 keeps `EVENT_SOURCE_NOT_APPROVED` |

## Truth rules

- Club Pulse is the canonical headline aggregate. The Operations Board is an
  entity view and never overwrites or averages headline metrics.
- V1 has not established matching definitions/grains for Pulse and detailed
  counts. Count mismatch diagnostics stay disabled until a later audited
  contract explicitly permits comparison.
- A successful source response with no row is `EMPTY EXACT`, not zero and not
  source failure.
- `observedAt` is frozen at the accepted source response. React rendering does
  not create a receipt timestamp. `asOf` comes only from source payloads.
- The headline system state uses only Club Pulse and Live Operations:
  `UNAVAILABLE` when neither is usable; `PARTIAL` when a usable core source is
  incomplete or another core source is unavailable; `STALE` when all core
  sources are usable but one is stale; `LIVE` only when both are exact/fresh.
  Finance, Digest and other supplemental sources do not downgrade this status.

## Runtime evidence boundary

This document records source semantics. It does not convert a source flag into
deployment proof. Q0 remains source-dark under `opsQuantDataHealthQ0=false`;
its pending RPCs are not applied and no Q0 Preview or owner UAT is claimed.

## Known V1 blockers and follow-ups

1. Registration and SePay pending RPCs require DB contract review, disposable
   tests, owner-gated apply, and live ACL verification.
2. Event Stream needs a common bounded append-only allowlist; raw `audit_logs`
   remains prohibited.
3. The Finance range is the existing UTC adapter range; it must not be called
   the club-local current month without a separate contract change.
4. No Gemini, decision room, autonomous action, financial write, DB migration
   or deployment belongs in this V1.
