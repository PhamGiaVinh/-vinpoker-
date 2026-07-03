# Runbook — Official club-wide regime flag (Series Intelligence, việc 2/3)

**Status: SOURCE-ONLY. Nothing applied, nothing deployed. Owner-gated.**

## What this is
The **club-wide, audited** version of the "chế độ đã thay đổi" (regime changed) mark.

- **PR5b (already shipped, #678)** = a **LOCAL** switch: stored in one browser only, per-operator.
- **This (việc 2/3)** = the **OFFICIAL** version: one authoritative mark per club in the DB, visible to
  every operator, with an append-only audit of **who** flipped it and **when**.

## ⚠️ Recommendation first
For a single non-technical owner, **PR5b (local switch) likely already covers the need**. This DB
version only adds value when **multiple operators** must share the same regime state, or you want an
**audit trail**. Applying it costs: a controlled SQL session + `types.ts` regen + a follow-up UI-wiring
PR. Apply **only if** you actually want club-wide/audited behavior. Otherwise leave it source-only.

## What ships in this PR (source-only)
- `supabase/migrations/20261214000000_series_regime_state.sql` — 2 tables + 1 owner-only RPC + RLS,
  wrapped in a `BEGIN … ROLLBACK` self-test harness (pasting it changes nothing).
  - `series_regime_state(club_id PK, changed, note, changed_at, changed_by, updated_at)`
  - `series_regime_audit(id, club_id, changed, note, actor, at)` — append-only log.
  - `set_club_regime_state(p_club_id, p_changed, p_note)` — `SECURITY DEFINER`, **owner-only**
    (`is_club_owner`), upserts state + appends an audit row. Reads go via RLS SELECT.
- **NO client wiring, NO flag, NO UI** in this PR — the UI upgrade is a post-apply step (below), so
  nothing calls a missing RPC.

## Apply (owner-gated, controlled SQL-Editor session)
1. **Read the file.** Confirm the anchors match live: `public.clubs(id)`, `public.is_club_owner(uuid, uuid)`.
2. **Self-test.** Paste the file AS-IS into SQL Editor and run. The `BEGIN … ROLLBACK` harness creates
   the objects, asserts the owner-guard rejects a non-owner, then **rolls back** — expect success with
   **no persisted change**. If any `ASSERT` fails, stop.
3. **Real apply.** Run only the statements **between `>>> APPLY FROM HERE >>>` and `<<< APPLY TO HERE <<<`**
   (i.e. without the `BEGIN`/`ROLLBACK` harness), inside your own transaction.
4. **Verify (read-only):**
   - `select to_regclass('public.series_regime_state'), to_regclass('public.series_regime_audit');` → both non-null.
   - Confirm RLS enabled + policies `srs_select`/`sra_select` exist; RPC is `SECURITY DEFINER`, `anon` has no execute.
   - As the club owner: `select public.set_club_regime_state('<your-club-uuid>', true, 'test');` → `{"status":"ok"}`;
     `select * from public.series_regime_state where club_id = '<your-club-uuid>';` → one row `changed=true`;
     one row in `series_regime_audit`. Then `set_club_regime_state('<club>', false, null)` to reset.
5. **Regen types:** `supabase gen types typescript` → commit the updated `types.ts`.

## Post-apply UI wiring (a separate follow-up PR, after step 5)
- Add flag `seriesRegimeFlagOfficial` (OFF), then wire `RegimeSwitch`/`RegimeNotice` to **prefer the DB
  state** (read `series_regime_state` for the current club; write via `set_club_regime_state`) and
  **fall back to the local switch** when the flag is off / no club / the RPC errors.
- Copy changes from "cục bộ trên máy này" → "cài đặt chung của CLB · có ghi nhận ai bật".
- Needs the current `clubId` in the Command Center (available via `useSeriesCapture().clubId` /
  `useNativeSeriesEvents` events) — thread it into `RegimeSwitch`.

## Rollback
Source-only now → rollback = don't apply (or `drop function set_club_regime_state; drop table
series_regime_audit; drop table series_regime_state;` if applied and unwanted). No UI depends on it yet.
