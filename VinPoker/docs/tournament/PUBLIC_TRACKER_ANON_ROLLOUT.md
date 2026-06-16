# Public tracker — anonymous read access (controlled rollout)

**Problem:** `/live/:id` is a public page, but every tracker read table grants `SELECT` only `TO authenticated`, so **non-logged-in visitors see an empty tracker**. This patch lets `anon` read the tracker data (the intended public-spectator design; hole cards are intentionally public, Triton-style).

**Migration:** `supabase/migrations/20260919000000_public_tracker_anon_read.sql` — **source-only, owner-gated apply.** Additive: 9 anon `SELECT` policies + table `GRANT`s + 2 RPC `EXECUTE` grants. No writes, no function logic change, no payroll/finance/operator impact.

## Scope (what becomes anon-readable)
- **Direct frontend reads:** `tournaments`, `tournament_seats`, `tournament_hands`, `hand_actions`, `hand_players`, `tournament_prizes`.
- **RPC-internal reads** (SECURITY INVOKER): `get_tournament_clock` → `tournament_levels`; `get_tournament_tables` → `tournament_tables`, `game_tables`. Both RPCs also get anon `EXECUTE`.
- `clubs` already grants anon read (club name works).

> Anon sees the **same rows/columns any logged-in user already sees** (existing policies are `USING(true)`). This only removes the login wall. **Column caveat:** to hide specific columns (e.g. `tournaments.rake_amount`) from anon, use public views + frontend changes — a separate effort.

## Controlled apply (Management-API; NO db push)
1. **Preflight (read-only):** `select count(*) from pg_policies where schemaname='public' and policyname like '%\_public\_anon\_read'` → expect **0**. Confirm the two function signatures exist: `get_tournament_clock(uuid)`, `get_tournament_tables(uuid)`.
2. **Dry-run:** `BEGIN; \i <migration>; ROLLBACK;` → no errors.
3. **Apply:** `BEGIN; \i <migration>; COMMIT;` (do NOT touch `schema_migrations`).
4. **Verify — structural:** the policy count above is now **9**; `has_function_privilege('anon','public.get_tournament_clock(uuid)','EXECUTE')` and `…get_tournament_tables(uuid)…` are **true**.
5. **Verify — functional (the real proof):** with the **anon/publishable key** (NOT the service token), `GET` a row from `tournament_seats` for a live tournament → returns rows (was empty/forbidden before). Best done from the browser as a logged-out user on `/live/:id`.
6. **Final report:** schema_migrations changed NO · db push NO · deploy_db NO · writes for anon NONE · payroll/finance impact NONE · rollback available YES.

## Rollback
`docs/emergency_rollbacks/PRE_PUBLIC_TRACKER_ANON_20260919000000.sql` — drops the 9 `*_public_anon_read` policies + revokes the anon grants. Structural only; reverts to authenticated-only.

## Safety
`schema_migrations` untouched · no `supabase db push` · no `deploy_db=true` · additive RLS only · existing authenticated policies untouched · no function bodies changed · reversible.
