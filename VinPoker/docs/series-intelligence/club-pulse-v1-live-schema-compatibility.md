# Club Pulse V1 Live Schema Compatibility

Read-only catalog audit: 2026-08-09. No row values or player/dealer identities were queried.

The source migration `20270110000003_series_club_live_pulse_v1.sql` was absent from the live migration ledger and `public.get_series_club_live_pulse_v1(uuid)` did not exist at audit time. This document records compatibility evidence only; it is not evidence of a database apply.

| Metric | Live source and compatible predicate | Result |
| --- | --- | --- |
| Club member profiles | `club_members.club_id`; current live schema has no active/archive marker | Compatible as current profile-row count |
| Event-day unique players | `tournaments.start_time timestamptz`, non-deleted/non-cancelled event; confirmed registrations; `tournament_entries.member_id` with player fallback | Compatible, partial when fallback identity is used |
| Event-day entries | Same event-day boundary; confirmed registration rows are bullets | Compatible |
| Players playing now | live/break/final-table tournaments; active tournament seats; entry member identity with player fallback | Compatible, partial when fallback identity is used |
| Running events | non-deleted tournaments in `live`, `break`, or `final_table` | Compatible |
| Open tables | non-deleted tournament and `tournament_tables.status = 'active'` | Compatible |
| Dealers on duty | non-deleted dealer, attendance `checked_in`, no checkout | Compatible |

## Event-Day Boundary

`uniquePlayersToday` and `entriesToday` mean confirmed bullets belonging to tournaments whose canonical `start_time` falls inside the club's current local calendar day. Registration confirmation time does not define the day. Events with missing `start_time`, deleted events, and cancelled events fail closed by exclusion.

The day boundary is constructed as two timezone-aware instants. This preserves local-midnight behavior and 23/25-hour daylight-saving days where the configured IANA timezone observes DST.

## Privacy Boundary

The owner view may retain trusted aggregate values. Any external Copilot context must pass through the export-safe mapper: small cohorts and non-exportable metrics become `null` before `contextHash` is calculated, while provenance and suppression reasons remain visible.
