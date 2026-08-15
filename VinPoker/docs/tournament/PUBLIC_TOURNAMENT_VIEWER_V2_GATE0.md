# Public Tournament Viewer V2 — Gate 0

Date: 2026-08-16

Scope: anonymous, read-only Production contract verification

Production project: names-only verification for `orlesggcjamwuknxwcpk`

No database, Edge Function, feature flag, authentication record, or business data was mutated during this probe. Credential values and response rows were not recorded.

## Result

`PUBLIC_VIEWER_BACKEND_CONTRACT_REQUIRED`

PR A may ship its source-only UI adapter and deterministic fixture with `publicTournamentRailV1=false`. PR B must not connect the viewer to Production until a dedicated sanitized public read contract is reviewed and deployed through a separate RED runbook.

## Anonymous contract evidence

| Contract | Result | Shape evidence |
| --- | --- | --- |
| `get_public_tournament_clock_summary` | Missing (`HTTP 404`) | Not callable on Production |
| `get_tournament_clock` | Available (`HTTP 200`) | Includes running, break, level and remaining-seconds fields |
| `get_tournament_tables` | Available (`HTTP 200`) | Returns only `table_id` and `table_name`; no `max_seats` or `status` |
| `tournaments` display projection | Available (`HTTP 200`) | Exact requested display columns only |
| `tournament_levels` display projection | Available (`HTTP 200`) | Exact requested structure columns only |
| `tournament_tables` display projection | Available (`HTTP 200`) | Exact requested table columns only |
| `tournament_seats` display projection | Available (`HTTP 200`) | Exact requested public roster columns only |
| `tournament_seats.player_id` | Available (`HTTP 200`) | Anonymous callers can currently retrieve it |

Frontend field selection is therefore a presentation projection, not a privacy or security boundary.

## Table identity finding

The live probe found that active `tournament_seats.table_id` values match `tournament_tables.id`, not `tournament_tables.table_id` (the physical `game_tables.id`). This conflicts with the proposed public URL contract where `table` must identify the physical game table. The integration must not guess or silently translate this identity.

## Required backend contract

A follow-up Draft RED PR must provide one caller-independent, sanitized public read seam that:

- returns the explicit clock phase and current/next blinds;
- returns authoritative running tables with one documented physical table identity, status, and `max_seats`;
- returns only the public seat fields required by the viewer;
- never returns `player_id` through that seam;
- preserves empty running tables;
- supports one consistent snapshot owner without privileged fallback.

The follow-up must not broaden existing anonymous table grants. Production apply remains a separate owner-gated action.
