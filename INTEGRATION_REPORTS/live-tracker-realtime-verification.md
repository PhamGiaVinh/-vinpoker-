# Live Tracker — Realtime Verification (Milestone A)

How to verify `20260808000000_tracker_realtime_publication.sql`. The migration only adds tables
to the `supabase_realtime` publication — it does not change schema, RLS, or any `src` code.

## 0. Apply the migration
Apply to a **local or branch** Supabase DB first (never prod without sign-off):
```bash
cd VinPoker
supabase db push          # or: supabase migration up
```
Re-running is safe — each `ADD TABLE` is wrapped to swallow `duplicate_object`.

## 1. Confirm publication membership (SQL)
```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```
**Expect** to see (among others): `hand_players`, `tournament_chip_counts`,
`tournament_hands`, `tournament_seats`, `tournaments`.
**Should NOT** see `hand_actions` (intentionally excluded — nothing subscribes to it).

## 2. End-to-end: viewer updates without refresh
1. Sign in as a user with the `tracker` role.
2. Tab A → `/tracker`; pick the live tournament; open the **Hand Input** (or **Table Draw**) tab.
3. Tab B → `/live/<tournamentId>` (the spectator viewer).
4. In Tab A, record a hand (or change a chip count / seat).
5. **Pass:** Tab B reflects the change within ~1s **without a manual refresh** (new hand number,
   updated stacks/seats, action timeline).

## 3. No duplicate channels / no leak
In the browser console on the `/live/<id>` tab:
```js
supabase.getChannels().length
```
Navigate away and back (unmount/remount the viewer) a few times. The count should return to a
stable baseline, not grow each time. Existing cleanup calls `supabase.removeChannel(channel)` on
unmount in `TournamentLiveTracker.tsx`, `TournamentLiveView.tsx`, and `TournamentLivePanel.tsx`.

## 4. RLS sanity
Realtime enforces the subscriber's RLS. The four tables are `FOR SELECT TO authenticated
USING (true)`, so any **logged-in** viewer receives events. An **anon** (logged-out) viewer
receives nothing — expected; the public spectator path is deferred to Milestone E via a
sanitized RPC.

## 5. Regression smoke (guarded modules still load)
Open and confirm no errors: **Dealer Swing**, **Bankroll**, **Staking**, **Account**,
**Documents**, **Feed**. None of these were touched by Milestone A.

## Rollback
To remove a table from the publication (if ever needed):
```sql
alter publication supabase_realtime drop table public.tournament_hands;
-- repeat for tournament_chip_counts, tournament_seats, hand_players
```
This reverts to the pre-migration state (viewer stops live-updating; no data loss).

## Acceptance
Milestone A is done when §1 lists the 4 tables, §2 shows a hand appearing in `/live` with no
refresh, §3 shows no channel growth, and §5 shows no regressions.
