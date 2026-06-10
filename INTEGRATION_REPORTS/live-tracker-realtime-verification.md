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

---

## Actual verification results (static, 2026-06-11)

**Checked by:** Claude Code, branch `feature/live-tracker-realtime-a-clean` (commits `cee518e`, `b8485c1`).
**DB tested:** None — Docker not running on this machine; no local Supabase stack available.
**Remaining for you:** §0 (apply migration) + §1 (publication query) + §2 (two-tab test) + §3 (channel-leak) + §5 (regression smoke).

> **Branch note:** `feature/live-tracker-realtime-a-clean` was created from `origin/main` and
> contains only the 2 Milestone A commits (cherry-picked from the previous dirty branch
> `feature/live-tracker-integration`). The old dirty branch can be deleted once this branch
> is verified and merged.

### What was verified statically

**S1 — SQL syntax and structure ✓**
All 4 `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` blocks are correctly
formed. Each wraps a single `ALTER PUBLICATION supabase_realtime ADD TABLE` statement. No syntax
issues found.

**S2 — No prior migration publishes these tables ✓**
Searched all `VinPoker/supabase/migrations/` for every `ADD TABLE` to `supabase_realtime`.
`tournament_hands`, `tournament_chip_counts`, `tournament_seats`, and `hand_players` do **not**
appear in any migration before `20260808000000`. The gap is confirmed real; this migration fills it
exactly and nothing else will conflict.

**S3 — No prior migration drops these tables ✓**
No migration contains `DROP TABLE … tournament_hands/seats/chip_counts/hand_players`. The
idempotency guard exists for live-DB drift only (not to undo a prior explicit drop).

**S4 — hand_actions correctly excluded ✓**
Searched `src/` for any `postgres_changes` subscription referencing `hand_actions` — **none
found**. Excluding it from the publication is correct; publishing it would add WAL cost for zero
realtime benefit.

**S5 — RLS posture reviewed ✓**
`tournament_hands`, `tournament_chip_counts`, `tournament_seats`, `hand_players` all have
`FOR SELECT TO authenticated USING (true)` in `20260608000001_tournament_live_tracker.sql`
(~lines 916–985). No RLS change is needed for logged-in realtime. anon cannot receive events —
by design.

**S6 — Subscription filter / replica identity match ✓**
Both `TournamentLiveView.tsx:259` and `TournamentLivePanel.tsx:72` subscribe with
`filter: tournament_id=eq.<id>`. For INSERT/UPDATE, the filter evaluates the NEW row (all columns
present), so DEFAULT replica identity (PK only) is sufficient. Filtered hard-DELETE events won't
fire (old row carries only PK), but deletes here are rare (voids use `is_voided`/`status`).

**S7 — No src/RLS/schema changes ✓**
The only file in the diff that belongs to Milestone A is the migration SQL. The three `src`
components that own realtime subscriptions are untouched.

**S8 — Branch diff is clean ✓ (verified on `feature/live-tracker-realtime-a-clean`)**
`git diff --name-status origin/main...HEAD` returns exactly:
```
A  INTEGRATION_REPORTS/live-tracker-audit.md
A  INTEGRATION_REPORTS/live-tracker-realtime-verification.md
A  VinPoker/supabase/migrations/20260808000000_tracker_realtime_publication.sql
```
No `vercel.json`, no `version.json`, no seat-assignment files, no `src` files present.
The old dirty branch (`feature/live-tracker-integration`) which contained a parallel session's
`vercel.json` commit (`cd48fc8`) has been superseded by this clean branch.

### Required to close Milestone A

| # | Test | Who | Status |
|---|------|-----|--------|
| §0 | Apply migration to staging/branch DB | You | ⏳ pending |
| §1 | `pg_publication_tables` query shows 4 tables | You | ⏳ pending |
| §2 | `/tracker` → hand → `/live` updates without refresh | You | ⏳ pending |
| §3 | `supabase.getChannels().length` stable on mount/unmount | You | ⏳ pending |
| §5 | Dealer Swing / Account / Bankroll / Feed load without errors | You | ⏳ pending |
