# Controlled apply runbook — `20260927000000_get_club_series_events`

Canonical, corrected runbook for live-applying the Series Intelligence owner-scoped read RPC.
Migration source: [`supabase/migrations/20260927000000_get_club_series_events.sql`](../../supabase/migrations/20260927000000_get_club_series_events.sql).

> **Docs-only.** This file documents the procedure; it executes nothing. Apply only in a
> dedicated, owner-approved session after the explicit phrase in §2 is given.

---

## 1. Current status

- PR **#327** merged **source-only** as `0c4ea7e` (squash). `origin/main` is at or after this commit.
- The RPC **file exists on `main`** (`supabase/migrations/20260927000000_get_club_series_events.sql`).
- The RPC is **NOT live** — it has not been applied to the database.
- **No DB apply** has happened: no `supabase db push`, no `deploy_db`, no Management API write,
  no `db query`. `schema_migrations` is unchanged. `types.ts` is unchanged. No frontend hook switch.

The object this runbook creates when applied:
`public.get_club_series_events(uuid, timestamptz, timestamptz)` — `SECURITY DEFINER`, `STABLE`,
`set search_path = public`, owner-scoped read, granted to `authenticated` only.

---

## 2. Required owner phrase before execution

Do **not** run any step below until the owner sends, verbatim:

```text
Run controlled apply for 20260927000000_get_club_series_events
```

Any other wording (including a diagnostic question or a "looks good") is **not** approval to apply.

Apply model: **single object**, via **Management API** or **`supabase db query --linked --file`**.
**Never** `supabase db push`. **Never** `deploy_db=true`. Following repo convention, `schema_migrations`
stays **untouched**; the source file already lives on `main` for the record, and `create or replace`
is idempotent so a future (gated) `db push` is a safe no-op.

---

## 3. Preflight — prerequisites exist (avoid a failed apply)

The function body depends on the `has_role` helper, the `app_role` enum value `super_admin`, and a
set of columns on `tournaments` / `tournament_registrations`. If any are missing the apply fails, so
check first.

```sql
-- helper used for the super_admin bypass
select to_regprocedure('public.has_role(uuid, public.app_role)') is not null as has_role_ok;   -- expect true

-- app_role enum includes 'super_admin'
select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'app_role' and e.enumlabel = 'super_admin'
) as super_admin_label_ok;                                                                       -- expect true
```

### 3.1 Required columns — robust missing-column query (NOT a brittle count)

Use the `EXCEPT` form so a failure names the exact missing column. **Do not** use the old
`count(*) = 8` assertion — it was wrong. The required `tournaments` column count is **9**, because the
function uses `where t.deleted_at is null`, so `deleted_at` is **required**, not optional.

```sql
-- tournaments: every column the function body reads must exist (empty result = OK)
select unnest(array[
  'id','name','start_time','buy_in','rake_amount',
  'service_fee_amount','prize_pool','club_id','deleted_at'   -- 9 required columns
]) as missing_col
except
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tournaments';
-- EXPECTED: 0 rows. Any row = a required column is missing → stop, do not apply.

-- tournament_registrations: counts source
select unnest(array['tournament_id','player_id','status']) as missing_col   -- 3 required columns
except
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tournament_registrations';
-- EXPECTED: 0 rows.
```

Optional equivalent count form (only if you prefer it): `tournaments` must return `count(*) = 9`
over the 9 columns above; `tournament_registrations` must return `count(*) = 3`.

---

## 4. Function absent / snapshot check + rollback note

```sql
select p.prosecdef, p.provolatile, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_club_series_events';
-- EXPECTED: 0 rows (function not yet live).
```

- **If 0 rows (expected)** → rollback note is a simple drop:
  ```sql
  drop function if exists public.get_club_series_events(uuid, timestamptz, timestamptz);
  ```
- **If rows exist (unexpected)** → snapshot the current definition first, save it to a
  `docs/emergency_rollbacks/PRE_*_get_club_series_events_20260927000000.sql` file, and the rollback is
  to re-apply that snapshot:
  ```sql
  select pg_get_functiondef('public.get_club_series_events(uuid,timestamptz,timestamptz)'::regprocedure);
  ```

---

## 5. Apply method (single object — NOT `db push`)

```bash
# Preferred: linked db query against the exact source file.
supabase db query --linked --file VinPoker/supabase/migrations/20260927000000_get_club_series_events.sql
```

or, equivalently, run the file contents through the **Management API** `run_query` endpoint. The file
applies three statements: `create or replace function …`, `revoke all … from public, anon`,
`grant execute … to authenticated`.

**Forbidden:** `supabase db push`, `deploy_db=true`, editing `schema_migrations`, applying any other
pending migration in the chain.

---

## 6. Post-apply verification

### 6.1 Definition flags — SECURITY DEFINER / STABLE / search_path

```sql
select p.prosecdef  as is_security_definer,   -- expect true
       p.provolatile as volatility,           -- expect 's' (STABLE)
       p.proconfig   as config                -- expect {search_path=public}
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_club_series_events';
```

### 6.2 Grants — authenticated EXECUTE granted; anon/public denied

```sql
select
  has_function_privilege('anon',          'public.get_club_series_events(uuid,timestamptz,timestamptz)', 'EXECUTE') as anon_can,  -- expect false
  has_function_privilege('authenticated', 'public.get_club_series_events(uuid,timestamptz,timestamptz)', 'EXECUTE') as auth_can;  -- expect true
```

### 6.3 Return shape — `gtd` present & nullable; no forbidden columns

```sql
select pg_get_function_result('public.get_club_series_events(uuid,timestamptz,timestamptz)'::regprocedure);
-- assert: contains `gtd numeric`;
-- assert: contains NONE of 'profit' / 'expected' / 'forecast' / 'overlay' / 'prediction'.
```

### 6.4 Owner-scope (functional) — owner sees only owned clubs

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<OWNER_UUID>","role":"authenticated"}';
select count(*) as total,
       count(distinct club_id) as clubs,
       bool_and(club_id in (select id from public.clubs where owner_id = '<OWNER_UUID>')) as all_owned  -- expect true
from public.get_club_series_events();
```

### 6.5 Cross-club denied

```sql
-- still the owner above, but request another owner's club
select count(*) as leaked_rows
from public.get_club_series_events(p_club_id := '<CLUB_OWNED_BY_SOMEONE_ELSE>');   -- expect 0
```

### 6.6 anon denied (functional)

```sql
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select * from public.get_club_series_events();   -- expect: permission denied (no EXECUTE grant)
```

### 6.7 super_admin behavior — verify ONLY if the helper works

Only assert this if §3 proved `public.has_role(uuid, public.app_role)` exists. Set claims to a known
super_admin uuid and confirm it returns rows beyond a single owner's clubs (i.e. the bypass branch is
reachable). If the helper is absent/non-functional, skip — do not invent behavior.

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<SUPER_ADMIN_UUID>","role":"authenticated"}';
select count(distinct club_id) as clubs_visible_to_super_admin
from public.get_club_series_events();   -- expect: more than one owner's worth, per data
```

### 6.8 Confirmed-registration counts match the source query

```sql
-- via the RPC (pick a known tournament T in an owned club)
select total_entries, unique_entries, reentries
from public.get_club_series_events(p_club_id := '<CLUB_OF_T>')
where event_id = '<T>';

-- authoritative source
select count(*)                  as total,
       count(distinct player_id) as uniq
from public.tournament_registrations
where tournament_id = '<T>' and status = 'confirmed';

-- assert: total_entries = total, unique_entries = uniq, reentries = total - uniq
```

### 6.9 `gtd` is null

```sql
select count(*) filter (where gtd is not null) as non_null_gtd
from public.get_club_series_events(p_club_id := '<OWNED_CLUB>');   -- expect 0 (GTD arrives in PR B)
```

---

## 7. Final report template (fill after apply)

```text
Operation name:            controlled_apply_get_club_series_events
Target project ref:        <ref>
Read/write status:         write (single function object)
Object touched:            function public.get_club_series_events(uuid, timestamptz, timestamptz)
schema_migrations changed: NO
deploy_db used:            NO
supabase db push used:     NO
Secrets exposed:           NO
Verification result:       <pass/fail per §6.1–6.9>
Rollback command:          drop function if exists public.get_club_series_events(uuid, timestamptz, timestamptz);
                           (or re-apply the PRE_* snapshot if the function pre-existed)
Next step:                 regen types.ts in a separate source-only PR
```

---

## 8. Next steps after a successful apply

1. **Regenerate `types.ts`** in a **separate source-only PR** (no behavior change) so the typed client
   knows the new RPC.
2. **Frontend hook switch PR** — only after types land: flip `useNativeSeriesEvents` from `.select()`
   to `.rpc('get_club_series_events', …)`; the "Nguồn dữ liệu" section then reads the server-derived
   native payload. Descriptive/readiness only — no forecast.
3. **PR B — GTD:** add nullable `tournaments.guarantee_amount` + a ClubAdmin create/edit GTD input +
   `create or replace` this RPC to return `guarantee_amount as gtd`. NULL still reports "thiếu GTD";
   GTD is never faked from `prize_pool`.
4. **Scenario Forecast Lite (Phase 4)** — later; rules-based Conservative/Base/Upside ranges with
   mandatory confidence + missing-data + overlay/GTD-risk + "không phải cam kết" disclaimers. Not the
   deferred learned/causal tier. See [`ROADMAP.md`](./ROADMAP.md) §6.
