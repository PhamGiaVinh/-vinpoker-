# Migration Recovery — D4a/D5e Execution Plan

**Document type:** PLAN ONLY — No commands in this document may be executed without explicit approval.  
**Created:** 2026-06-11  
**Status:** Draft — awaiting approval before any execution  
**Author:** Stage 3F analysis  

---

## 1. Current safe state

| Item | Status |
|---|---|
| PR #9 `chore/draft-remote-schema-baseline-clean` | **Draft, remote clean at `44c76c8`** |
| Local branch | Synced to `origin/chore/draft-remote-schema-baseline-clean` — no local-only commits |
| Baseline migration `20260611000001_remote_only_schema_baseline.sql` | Not merged, not applied, not in remote migration history |
| D4a (CI workflow repair edit) | **Not approved** |
| D5e (mark baseline as applied) | **Not approved** |
| `20260609000002_recalculate_june_payroll.sql` | Not in remote history; local file exists; must never auto-apply |
| Existing CI repair list (26 versions) | Already in workflow — pre-emptively marking local-only mis-ordered versions as reverted |
| `continue-on-error: true` on db push step | Still present — db push failures are silent |
| Milestone B | Blocked |

---

## 2. Objective

After D4a + D5e are executed:

1. `supabase db push --linked --include-all` no longer fails with "remote migration history diverges from local files"
2. `20260611000001_remote_only_schema_baseline.sql` is treated by the CLI as already-applied — it will not be re-executed on the remote dev DB
3. `20260609000002_recalculate_june_payroll.sql` is permanently skipped — it will never execute automatically in CI
4. All 99 remote-only versions are marked as reverted in `schema_migrations` — they no longer block the consistency check
5. `continue-on-error: true` can be removed from the db push step **only after** at least one successful push is confirmed
6. The pipeline is healthy enough to eventually cherry-pick Milestone A (`20260808000000`) from `feature/live-tracker-realtime-a-clean`

---

## 3. Recommended future sequence

### Option A — Merge PR #9 (baseline-only), then run D4a/D5e
1. Merge PR #9 to `main`
2. CI triggers → existing repair (26 versions) runs → `db push` runs
3. `db push` sees `20260611000001` as a new untracked local file → **tries to apply the baseline**
4. With `continue-on-error: true`, the application attempt is silent even if it partially fails
5. Objects that already exist are handled by `IF NOT EXISTS` / `CREATE OR REPLACE` / `duplicate_object` guards, but the trigger `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` would fire again, and the event trigger block (now commented out) would be skipped

**Risk:** Even with the idempotency guards in place, applying a baseline migration that was designed to be pre-marked is a messy outcome. The repair step must happen **before** CI sees the new file. Option A guarantees the repair has not happened before the file lands.

**Verdict: NOT recommended.**

---

### Option B — Add D4a workflow edit into PR #9 before merge ✅ RECOMMENDED

Extend PR #9's branch to also contain the CI workflow edit. The PR would contain:
- `VinPoker/supabase/migrations/20260611000001_remote_only_schema_baseline.sql` (already present)
- `INTEGRATION_REPORTS/remote-schema-baseline-draft-review.md` (already present)
- `.github/workflows/vbackerworkflowmain.yml` — expanded repair block

When this combined PR merges, CI runs in this order:

```
1. Repair step (expanded):
     repair --status reverted   <99 remote-only versions>
     repair --status reverted   20260609000002
     repair --status applied    20260611000001   ← pre-marks baseline before db push

2. db push --linked --include-all
     → no divergence errors (99 reverted, baseline pre-marked)
     → 20260609000002 skipped (reverted)
     → 20260611000001 skipped (already marked applied)
     → only genuinely new local migrations apply

3. Edge functions deploy
4. Vercel deploy
```

**Why this is safe:**
- The repair for `20260611000001` runs in the same CI job, in the same step, before `db push` sees the file
- There is no window where CI can see the baseline file without the repair having run first
- The workflow and migration file land atomically (same commit, same merge)
- `continue-on-error: true` remains on db push as an additional safety net during this first run

**Verdict: RECOMMENDED.**

---

### Option C — Separate D4a PR before PR #9

1. Create a new PR that only edits the CI workflow:
   - Add `repair --status reverted` for the 99 remote-only versions
   - Add `repair --status reverted 20260609000002`
   - Do NOT include `repair --status applied 20260611000001` (baseline file not yet merged)
2. Merge D4a PR → CI runs → repairs run → db push runs (no baseline file yet → clean)
3. Then merge PR #9 (baseline file only) → CI runs → db push sees `20260611000001` as NEW → tries to apply

**Risk:** Step 3 is the same failure mode as Option A — the baseline gets applied because the `--status applied` repair has not been added.

Unless Step 1 also adds `repair --status applied 20260611000001` pre-emptively before the file exists locally. That is technically possible but fragile — repairing a version before the file exists is non-standard and may cause CLI confusion.

**Verdict: NOT recommended without modifying the plan to also include the baseline repair-mark in the D4a-only PR.**

---

## 4. D5e plan — baseline mark-applied (DO NOT RUN)

### Intent

`20260611000001_remote_only_schema_baseline.sql` was created to capture remote-only schema objects for git history and fresh-build reproducibility. All objects in this file already exist on the remote dev DB. The migration must be marked as `--status applied` in the remote dev DB's `schema_migrations` table BEFORE `supabase db push` sees it, so the CLI treats it as already done and does not execute it.

### Preconditions (all must be true before executing)

1. The baseline file is present on the branch being merged (it is in PR #9 ✓)
2. The branch diff is verified clean (exactly 2–3 files: migration, review doc, workflow) — no contamination
3. No local branch contamination (local = remote branch HEAD)
4. D4a approval has been given (see Section 5)
5. The combined PR has been reviewed and approved for merge
6. Current remote migration history has been re-verified (see Section 5.2 — the June 11 audit may be stale)

### Placeholder commands — DO NOT RUN

```bash
# DO NOT RUN — requires explicit D5e approval
# Context: run INSIDE the CI workflow repair step, BEFORE supabase db push

supabase migration repair --status applied 20260611000001
```

This command:
- Adds a row `(version='20260611000001', name='remote_only_schema_baseline', status='applied')` to the remote dev DB's `schema_migrations` table
- Causes `db push` to skip this version entirely
- Does NOT alter the baseline file or any schema object
- Is NOT reversible without a manual `repair --status reverted 20260611000001` (which would cause db push to try to re-apply it)

### Placement in CI workflow

The repair command must be added to the existing "Repair migration history" step in `.github/workflows/vbackerworkflowmain.yml`, **before** the "Deploy database migrations" step. The repair and db push are in separate steps; the repair step runs first (lines 45–58), db push step runs second (lines 61–67).

---

## 5. D4a plan — repair list for 99 remote-only versions + payroll skip (DO NOT RUN)

### 5.1 Source of the 99 remote-only versions

Cross-referenced from:
- **`D:\vinpoker-prod-audit-20260611-051112\01_migration_history.json`** — 321 rows (remote `schema_migrations` as of 2026-06-11 05:11:12)
- **Local `VinPoker/supabase/migrations/`** — local migration files

Versions present in remote history but with no corresponding local `.sql` file: **99 versions** (timestamps ranging from `20260604164153` through `20260610101331`).

### 5.2 ⚠ Pre-execution re-verification required

**The audit data is from 2026-06-11 05:11:12.** A more recent capture (`VinPoker/tmp_applied_versions.json`) shows only 223 rows in the remote history — 98 fewer rows than at audit time. This discrepancy is unresolved. It may indicate:
- Some versions were already repaired (reverted) since the audit
- Or `tmp_applied_versions.json` was captured at a different scope

**Before executing D4a, the current remote migration history must be re-verified with:**

```bash
# DO NOT RUN — requires explicit approval
# Run to re-verify current remote state before constructing repair list

supabase migration list --linked
```

Or via a read-only SELECT (no DB write, safe at any time):

```sql
-- DO NOT RUN as DB write — this is a SELECT only
SELECT version, name FROM schema_migrations ORDER BY version;
```

Re-compute remote-only versions from the freshly-captured list. Do not rely solely on the June 11 audit list.

### 5.3 How the 99 versions should be handled

Each remote-only version is marked `--status reverted`. This removes it from the divergence check without altering any schema object.

**All 99 remote-only versions (from June 11 audit — must re-verify before use):**

```
20260604164153  20260604164631  20260604164656  20260604164702
20260605005530  20260605024551  20260605024644  20260605024703
20260605024806  20260605033729  20260605051300  20260605180630
20260605181025  20260605181112  20260605183230  20260605185842
20260605212950  20260605212952  20260605220856  20260605221308
20260605222734  20260605230708  20260605230718  20260605232605
20260606002338  20260606011317  20260606011333  20260606011348
20260606011559  20260606011710  20260606011818  20260606011909
20260606012012  20260606012151  20260606013102  20260606075415
20260606075453  20260606084249  20260606084357  20260606094231
20260606094341  20260606204225  20260607070036  20260607070130
20260607070220  20260607070421  20260607071706  20260607085152
20260607101712  20260607102336  20260607102703  20260607102802
20260607102840  20260607102922  20260607175954  20260607180036
20260607180339  20260607191637  20260608163035  20260608165127
20260608170028  20260608171043  20260608171756  20260608175855
20260608182839  20260608193604  20260608204652  20260608204747
20260608204932  20260608205720  20260608205754  20260608211714
20260608212754  20260608220356  20260608222750  20260608230341
20260608235435  20260609004223  20260609010626  20260609012601
20260609023936  20260609024339  20260609024540  20260609024933
20260609031730  20260609031922  20260609032935  20260609033038
20260609034817  20260609034919  20260609161617  20260609184902
20260609190403  20260609194041  20260609235919  20260610004908
20260610075922  20260610080904  20260610101331
```

### 5.4 How `20260609000002` should be handled

`20260609000002_recalculate_june_payroll.sql` (local file, D3d decision):
- **Not in remote history** (confirmed from June 11 audit)
- The local file contains financial data mutations (BHXH/BHYT/BHTN/PIT recalculation for all June 2026 payroll, hardcoded user UUID)
- Must be permanently prevented from auto-applying in CI
- Treatment: `repair --status reverted 20260609000002`

This adds a "reverted" record to remote `schema_migrations`, causing `db push` to skip it permanently on subsequent runs.

### 5.5 How `20260611000001` fits into the repair list

`20260611000001_remote_only_schema_baseline.sql` (local file, this baseline):
- **Not in remote history** (confirmed — we created this file locally)
- Objects already exist on the remote DB
- Must be marked `--status applied` so db push does not re-execute it
- Treatment: `repair --status applied 20260611000001`

This is a `--status applied` mark, not `--status reverted`. The distinction matters: `applied` tells the CLI "this version ran successfully"; `reverted` tells it "this version was intentionally skipped." Applied is correct here because the schema objects do genuinely exist on the remote DB.

### 5.6 Placement and ordering within CI workflow (DO NOT RUN)

The expanded repair step would replace the current "Repair migration history" step. The `--status applied` for the baseline must be the **last** repair command in the block, so all 99 reverts complete before the baseline is marked applied.

```yaml
# DO NOT APPLY — requires D4a approval
# This shows the INTENDED structure only

- name: Repair migration history
  run: |
    # 1. Existing 26 repair-reverts (already in workflow — unchanged)
    supabase migration repair --status reverted \
      20260602042631 20260602050206 20260602050407 20260602050446 \
      20260602060958 20260602072718 20260602205733 20260602205740 \
      20260602213759 20260602233941 20260603014807 20260603014945 \
      20260603015117 20260603015244 20260603015331 20260603020436 \
      20260603021314 20260603143139 20260603143207 20260603152443 \
      20260715000001 20260715000002 \
      20260716000000 20260717000000 20260718000000 \
      20260604144906

    # 2. Permanent skip: recalculate_june_payroll (D3d — financial mutation, never auto-apply)
    supabase migration repair --status reverted 20260609000002

    # 3. Remote-only versions from June 4–10 (99 total — re-verify list before applying)
    supabase migration repair --status reverted \
      20260604164153 20260604164631 20260604164656 20260604164702 \
      20260605005530 20260605024551 20260605024644 20260605024703 \
      20260605024806 20260605033729 20260605051300 20260605180630 \
      20260605181025 20260605181112 20260605183230 20260605185842 \
      20260605212950 20260605212952 20260605220856 20260605221308 \
      20260605222734 20260605230708 20260605230718 20260605232605 \
      20260606002338 20260606011317 20260606011333 20260606011348 \
      20260606011559 20260606011710 20260606011818 20260606011909 \
      20260606012012 20260606012151 20260606013102 20260606075415 \
      20260606075453 20260606084249 20260606084357 20260606094231 \
      20260606094341 20260606204225 20260607070036 20260607070130 \
      20260607070220 20260607070421 20260607071706 20260607085152 \
      20260607101712 20260607102336 20260607102703 20260607102802 \
      20260607102840 20260607102922 20260607175954 20260607180036 \
      20260607180339 20260607191637 20260608163035 20260608165127 \
      20260608170028 20260608171043 20260608171756 20260608175855 \
      20260608182839 20260608193604 20260608204652 20260608204747 \
      20260608204932 20260608205720 20260608205754 20260608211714 \
      20260608212754 20260608220356 20260608222750 20260608230341 \
      20260608235435 20260609004223 20260609010626 20260609012601 \
      20260609023936 20260609024339 20260609024540 20260609024933 \
      20260609031730 20260609031922 20260609032935 20260609033038 \
      20260609034817 20260609034919 20260609161617 20260609184902 \
      20260609190403 20260609194041 20260609235919 20260610004908 \
      20260610075922 20260610080904 20260610101331

    # 4. Pre-mark baseline as applied (runs BEFORE db push in next step)
    supabase migration repair --status applied 20260611000001
  working-directory: ./VinPoker
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASEACCESSTOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

### 5.7 Why `continue-on-error` must remain until after first successful validation

`continue-on-error: true` on the db push step is a safety net that prevents CI from failing the entire deploy if db push encounters a non-fatal migration error. It should remain in place until:

1. The first post-repair `db push` completes and its output is inspected
2. No unexpected migrations were attempted or failed
3. `supabase migration list --linked` confirms the expected state (see Section 7)

Removing `continue-on-error` before validation would cause CI to fail hard on the first migration error encountered, which could block edge function deploys and Vercel deploys even for unrelated schema changes.

---

## 6. Risk controls

| Risk | Control |
|---|---|
| Docker / local Supabase | Never used — all operations via `--linked` against remote dev DB |
| `db push` without repair | Never run `db push` until repair step has been confirmed in the same workflow run |
| `migration repair` without approval | Repair commands only run inside the CI workflow step after explicit D4a approval and PR merge |
| CI workflow backup | Before editing `.github/workflows/vbackerworkflowmain.yml`, record exact current content (already captured in git history) |
| Branch diff verification | Before merging PR, verify `git diff --name-status origin/main...HEAD` shows expected files only |
| GitHub PR diff verification | After push, verify `gh pr view <N> --json files` shows expected files only — no forbidden files |
| Parallel session contamination | Before any push, run `git log --oneline origin/<branch>..HEAD` — must be empty or show only intentional commits; `git reset --hard origin/<branch>` if contaminated |
| Never push contaminated local branch | Confirmed rule: if `origin/<branch>..HEAD` is non-empty and the extra commits are not intentional, reset before any push |
| `20260609000002` execution | Marked `--status reverted` in repair step — never in `--status applied` list |
| Event trigger creation | `CREATE EVENT TRIGGER rls_auto_enable_trigger` is commented out in baseline — not executable SQL |
| `20260611000001` re-execution | Must be in `repair --status applied` list BEFORE `db push` in same CI run |
| Remote history stale | Re-verify current remote state with `supabase migration list --linked` before constructing final D4a repair list |
| Audit data timestamp gap | `tmp_applied_versions.json` shows 223 rows vs 321 in June 11 audit — resolve this discrepancy before executing |

---

## 7. Verification plan after future execution (DO NOT RUN NOW)

### 7.1 Migration list expected state

```bash
# DO NOT RUN — verification step after D4a/D5e execution

supabase migration list --linked
```

Expected output:
- All 99 remote-only versions: status `REVERTED` (not `APPLIED` or blank)
- `20260609000002`: status `REVERTED`
- `20260611000001`: status `APPLIED` (but not executed — pre-marked)
- All other local migrations with local files: status `APPLIED`
- No versions with status blank or `PENDING` that shouldn't be pending

### 7.2 `supabase db push` expected output

```bash
# DO NOT RUN — after repair verification only

supabase db push --linked --include-all
```

Expected:
- No "remote migration history diverges from local" error
- No attempt to apply `20260611000001` (should say "already applied" or skip silently)
- No attempt to apply `20260609000002` (should say "reverted" or skip silently)
- Only genuinely new local migrations (if any) are applied
- Exit code 0

If db push still fails after repair: do NOT remove `continue-on-error` — investigate first.

### 7.3 Post-push function checks

After a successful db push, verify the critical functions on the remote dev DB exist and have correct signatures:

```sql
-- DO NOT RUN — post-push DB check only
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'is_club_tracker', 'tracker_club_ids', 'audit_tournament_hand',
    'get_escalation_config', 'reconcile_ghost_assignments',
    'club_local_date', 'tournament_break_all_tables',
    'reconcile_dealer_states', 'release_dealer_from_table',
    'get_swing_metrics', 'force_release_stuck_assignment',
    'cleanup_old_diagnostic_logs', 'rls_auto_enable'
  );
```

All 13 functions should be present.

### 7.4 Verify baseline did not execute

Check that `tournament_hand_audit_log` audit entries were NOT created with a `created_at` timestamp matching the deployment time (which would indicate the trigger fired during a fake INSERT):

```sql
-- DO NOT RUN — post-push check only
SELECT MIN(created_at), MAX(created_at) FROM tournament_hand_audit_log;
```

No entries from deployment time = baseline was not re-executed.

### 7.5 Verify no `UPDATE dealer_payroll` from recalculate_june_payroll

```sql
-- DO NOT RUN — post-push check only
-- Verify june payroll migration never ran by checking
-- if the backup table it would create exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'dealer_payroll_backup_before_june_recalc'
) AS backup_table_exists;
```

Expected: `false` — if `true`, the migration ran and its backup table was created (alert immediately).

### 7.6 Verify tracker realtime remains blocked

```sql
-- DO NOT RUN — post-push check only
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('tournament_hands','tournament_chip_counts','tournament_seats','hand_players');
```

Expected: **0 rows** — these tables should NOT be in the realtime publication until Milestone A (`20260808000000`) is explicitly cherry-picked after pipeline is healthy.

---

## 8. Rollback / stop plan

### 8.1 If repair command fails

The `supabase migration repair` command targets the remote dev DB's `schema_migrations` table. If it fails:
1. The subsequent `db push` will still fail (repair didn't complete)
2. `continue-on-error: true` on db push means CI won't hard-fail
3. Do NOT retry without investigating — check which version caused the failure
4. A repair failure for a version that doesn't exist in remote history is expected to be a no-op (CLI may warn but not error) — verify CLI behavior before assuming failure

### 8.2 If db push tries to apply the baseline

Symptoms: db push output shows `20260611000001` being applied (not skipped).

Cause: `repair --status applied 20260611000001` did not run before db push.

Immediate action:
1. Check CI workflow step order — the repair step must precede the db push step
2. Check that the repair step output shows `20260611000001` being marked applied
3. If baseline was partially applied:
   - Objects already existed (IF NOT EXISTS guards) — no new schema damage
   - The trigger was DROP+CREATE (idempotent) — no damage
   - Check `schema_migrations` on the remote DB to see if the version is now marked `applied` with the wrong timestamp
   - Do NOT attempt to revert the baseline — the objects should remain

### 8.3 If PR diff contains unexpected files

Before merging, run:
```bash
gh pr view <N> --json files --jq '[.files[].path]'
```
If any of these appear: abort merge, investigate, clean branch as per parallel session contamination protocol.

Expected files for the combined D4a+PR9 PR:
- `INTEGRATION_REPORTS/remote-schema-baseline-draft-review.md`
- `VinPoker/supabase/migrations/20260611000001_remote_only_schema_baseline.sql`
- `.github/workflows/vbackerworkflowmain.yml`
- (optionally) `INTEGRATION_REPORTS/migration-recovery-decisions.md` (if updated for D4a)

No `src/` files, no `version.json`, no `vercel.json`, no seat-assignment migrations.

### 8.4 If local branch becomes contaminated again

Symptoms: `git log --oneline origin/<branch>..HEAD` shows unexpected commits.

Protocol:
1. Do NOT push the contaminated local branch
2. Create a backup branch: `git branch backup/<commit>-<date>`
3. `git reset --hard origin/<branch>` — discard local contamination
4. Verify `git log --oneline origin/<branch>..HEAD` is now empty
5. Proceed with intended edits only
6. Before push: re-verify diff with `git diff --name-status origin/main...HEAD`

---

## Appendix A — Audit data provenance

| File | Captured | Rows | Trust level |
|---|---|---|---|
| `D:\vinpoker-prod-audit-20260611-051112\01_migration_history.json` | 2026-06-11 05:11:12 | 321 | **High** — Stage 1B systematic audit |
| `VinPoker/tmp_applied_versions.json` | Unknown (more recent) | 223 | **Untrusted** — parallel session artifact; 98 fewer rows than audit; discrepancy unresolved |

**Before executing D4a:** the 99-version list from the June 11 audit must be cross-checked against the current remote state using `supabase migration list --linked` (read-only, no DB write).

## Appendix B — D4a/D5e approval checklist

Before asking for D4a/D5e approval, confirm:

- [ ] Remote migration history re-verified (current state, not just June 11 audit)
- [ ] `tmp_applied_versions.json` discrepancy resolved (321 vs 223 rows)
- [ ] Branch diff for combined PR verified: exactly 3 files (baseline, review doc, workflow)
- [ ] Workflow edit reviewed: repair order is correct (99 reverts → 20260609000002 revert → 20260611000001 applied → db push)
- [ ] PR is Draft until all pre-merge checks pass
- [ ] No parallel session commits on the PR branch
- [ ] `continue-on-error: true` retained on db push step
- [ ] Event trigger creation still commented out in baseline
- [ ] Milestone B still blocked
