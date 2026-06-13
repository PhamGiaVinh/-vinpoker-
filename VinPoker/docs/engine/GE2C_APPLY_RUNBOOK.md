# GE-2C Apply Runbook — `20260820000000_online_poker_runtime_rpcs.sql`

**Status:** prepared, **NOT executed.** This runbook is for a future **owner-approved, dedicated DB session.** Nothing here is run during the authoring/shell session.
**Project ref:** `orlesggcjamwuknxwcpk` (Supabase, VinPoker prod).
**Migration:** `supabase/migrations/20260820000000_online_poker_runtime_rpcs.sql` (source-only on `origin/main` @ `9b0fdd1`).
**Process model:** identical to GE-2B (`20260817000000` / `20260817000001`) — controlled single-file apply via the **Management API query endpoint** with the CLI-keyring token. **No `supabase db push`. No `deploy_db=true`. No replay of the `20260801→20260813` chain.**
**Outcome contract:** the migration creates the flag table + 9 `op_*` RPCs. **The runtime stays dark** — `online_poker_config.enabled` is left `false`. Enabling is a *separate* owner operation.

---

## 0. Required final-report defaults (must hold at the end)

```
Schema migrations changed:  YES (exactly one version row: 20260820000000)
deploy_db=true used:        NO
supabase db push used:      NO
pending migrations applied:  NO (only this one file, by hand)
Runtime enabled:            NO (online_poker_config.enabled stays false)
Secrets exposed:            NO
```

---

## 1. Preconditions (verify before touching anything)

1. **Owner has explicitly opened the GE-2C apply session** (this is a controlled production patch — Track A protected-module rules apply).
2. **GE-2B is live** (the 10 `online_poker_*` tables exist). Confirm:
   ```sql
   SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'online_poker_%';
   -- expect 10
   ```
3. **The runtime RPCs are NOT already present** (idempotent re-apply is fine, but confirm the starting state):
   ```sql
   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname LIKE 'op\_%' ORDER BY 1;
   -- expect 0 rows on a clean first apply
   ```
4. **Slot is free** in live `schema_migrations`:
   ```sql
   SELECT version FROM supabase_migrations.schema_migrations
   WHERE version = '20260820000000';
   -- expect 0 rows
   ```
5. **Migration reconciliation is NOT in scope.** Do not apply, replay, or touch any other pending migration. This session applies exactly one file.
6. **`has_role(uuid, app_role)` and `update_updated_at_column()` exist** (the migration depends on both):
   ```sql
   SELECT 'has_role' AS fn, count(*) FROM pg_proc WHERE proname = 'has_role'
   UNION ALL
   SELECT 'update_updated_at_column', count(*) FROM pg_proc WHERE proname = 'update_updated_at_column';
   -- expect each >= 1
   ```

> **Pre-apply hardening decision (from the security review, N2/P2):** the chip-conservation post-sum is asymmetric with the pre-sum for `sitting_out`/`empty` wire seats. It is **latent** (the Edge never deals such seats today) so apply-as-is is safe, but since the file is unapplied the cleaner path is to fold the one-line fix in first. **Owner decides** between (a) apply the file as-is, or (b) apply with the §3 fix folded in. Either is safe for the current Edge; (b) future-proofs it. See `GE2C_SECURITY_REVIEW.md` §N2 for the exact line.

---

## 2. Snapshot / evidence (pre-apply)

Record into the apply report (and keep as the rollback evidence, mirroring the GE-2B version-row `statements[]`/`rollback[]` precedent):

```sql
-- current op_* surface (expect empty), config table presence (expect absent), live version slot (expect absent)
SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname LIKE 'op\_%' ORDER BY 1;

SELECT to_regclass('public.online_poker_config') AS config_table;  -- expect NULL

SELECT version FROM supabase_migrations.schema_migrations
WHERE version >= '20260819000000' ORDER BY version;  -- context: neighbouring slots
```

No function bodies need snapshotting (this is an additive create; rollback is a clean DROP — see §8). There is **no live object being replaced**, so there is no "before" body to preserve.

---

## 3. Apply (controlled, single file)

**Method (exactly as GE-2B):** POST the file's SQL to the Management API query endpoint with the CLI-keyring token. The token is read from the Windows credential store (`Supabase CLI:supabase`) via the `CredRead` P/Invoke and **never printed**. The helper `sbq.ps1 -SqlFile <path>` already encapsulates this.

```
POST https://api.supabase.com/v1/projects/orlesggcjamwuknxwcpk/database/query
Authorization: Bearer <token from CLI keyring — never echoed>
Body: { "query": "<full text of 20260820000000_online_poker_runtime_rpcs.sql>" }
```

Rules:
- Apply the file **verbatim** from the `origin/main` blob (`git show origin/main:VinPoker/supabase/migrations/20260820000000_online_poker_runtime_rpcs.sql`) — or, if the owner chose option (b), the source with **only** the N2 one-line filter added:
  ```sql
  -- in op_submit_action, the v_post_total query (≈L277-278) becomes:
  SELECT COALESCE(SUM((s->>'stack')::bigint), 0) + (p_new_state->>'pot')::bigint INTO v_post_total
  FROM jsonb_array_elements(p_new_state->'seats') AS s
  WHERE (s->>'status') IN ('active', 'folded', 'allin');
  ```
- The migration is wrapped in its own `BEGIN; … COMMIT;` — apply as one statement batch.
- **Re-run once** to prove idempotency (all objects use `CREATE OR REPLACE` / `CREATE TABLE IF NOT EXISTS` / `INSERT … ON CONFLICT DO NOTHING` / `DROP POLICY IF EXISTS` / `DROP TRIGGER IF EXISTS`). The second run must succeed with no error and no duplicate row.
- **Do not** flip `online_poker_config.enabled`. It stays `false`.

---

## 4. Post-apply verification — existence & shape

```sql
-- 4a. all 9 RPCs present with the right signatures
SELECT proname, pg_get_function_identity_arguments(p.oid) AS args, prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname LIKE 'op\_%' ORDER BY 1;
-- expect 9: op_is_enabled, op_load_action_context, op_start_hand, op_submit_action,
--           op_timeout_sweep, op_get_my_hole_cards, op_sit_down, op_stand_up, op_claim_daily_chips
-- prosecdef must be true for ALL.

-- 4b. config singleton seeded, dark
SELECT id, enabled FROM public.online_poker_config;   -- expect (t, false) — exactly one row
SELECT public.op_is_enabled();                        -- expect false

-- 4c. config RLS in place
SELECT polname, cmd FROM pg_policies WHERE tablename = 'online_poker_config' ORDER BY 1;
-- expect op_config_select (SELECT) + op_config_admin_write (ALL)

-- 4d. updated_at trigger present
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.online_poker_config'::regclass AND NOT tgisinternal;
-- expect trg_online_poker_config_updated_at
```

---

## 5. Post-apply verification — search_path & volatility

```sql
SELECT proname,
       prosecdef AS sec_def,
       provolatile AS vol,                          -- s=stable, v=volatile
       proconfig                                     -- expect {search_path=public}
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname LIKE 'op\_%' ORDER BY 1;
-- Every op_* : sec_def = true, proconfig contains search_path=public.
-- STABLE (s): op_is_enabled, op_load_action_context, op_timeout_sweep, op_get_my_hole_cards.
-- VOLATILE (v): op_start_hand, op_submit_action, op_sit_down, op_stand_up, op_claim_daily_chips.
```

---

## 6. Post-apply verification — GRANT/REVOKE matrix (the security boundary)

```sql
-- ACL per RPC. roles: anon / authenticated must NOT appear for write RPCs.
SELECT p.proname, r.rolname AS grantee
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public' AND p.proname LIKE 'op\_%' AND a.privilege_type = 'EXECUTE'
ORDER BY p.proname, r.rolname;
```

Expected grantees (anything else = STOP):

| RPC | allowed EXECUTE grantees |
|---|---|
| `op_load_action_context` | `service_role` only |
| `op_start_hand` | `service_role` only |
| `op_submit_action` | `service_role` only |
| `op_timeout_sweep` | `service_role` only |
| `op_is_enabled` | `authenticated`, `service_role` |
| `op_get_my_hole_cards` | `authenticated`, `service_role` |
| `op_sit_down` | `authenticated`, `service_role` |
| `op_stand_up` | `authenticated`, `service_role` |
| `op_claim_daily_chips` | `authenticated`, `service_role` |

Also confirm `PUBLIC` (empty `grantee` / `=X` in raw `proacl`) carries **no** EXECUTE on any `op_*`.

---

## 7. Post-apply LIVE proofs (G3/G4 — the deferred behavioural checks)

These need the DB and so are run **here**, not in the authoring session. Run as the relevant role (use a scoped session/JWT, or `SET ROLE`).

```sql
-- G3-a: service_role CAN call a write RPC (use a safe read-shaped one). Disabled flag => 'disabled' (proves reachability without mutating).
SET ROLE service_role;
SELECT public.op_timeout_sweep();                     -- expect {"outcome":"disabled", ...} (NOT a permission error)
RESET ROLE;

-- G3-b: authenticated is DENIED the write surface.
SET ROLE authenticated;
SELECT public.op_load_action_context('00000000-0000-0000-0000-000000000000');  -- expect: permission denied for function op_load_action_context
RESET ROLE;
-- repeat for op_start_hand / op_submit_action / op_timeout_sweep — all must raise "permission denied".

-- G3-c: anon is DENIED everywhere (including self RPCs).
SET ROLE anon;
SELECT public.op_claim_daily_chips();                 -- expect: permission denied for function op_claim_daily_chips
RESET ROLE;

-- G3-d: authenticated CAN reach self RPCs but the flag gates them.
SET ROLE authenticated;  -- (with a real auth.uid() in a true session)
SELECT public.op_claim_daily_chips();                 -- expect {"outcome":"disabled"} while flag is false
RESET ROLE;
```

> **G4 idempotency / forbidden-seat / race-lost / chip-conservation** are exercised only once a hand exists, which requires the flag ON. Defer the full G4 live drill to the **enablement** session (flag flip), where a scripted hand can be dealt in a throwaway table and:
> - the same `idempotency_key` replays the stored response (no second action row),
> - an action for a seat the actor does not own returns `forbidden`,
> - a stale `expected_state_version` returns `race_lost`,
> - a hand-tampering attempt that breaks Σ(stacks)+pot returns `chip conservation violated`.
> Keep that drill on a disposable table; never on a real player's hand.

---

## 8. Record the version row

Mirror the GE-2B precedent: insert the migration version with the full `statements[]` and a `rollback[]` array so the row is self-documenting.

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260820000000',
  'online_poker_runtime_rpcs',
  ARRAY[ /* the full statement list actually executed, in order */ ]
)
ON CONFLICT (version) DO NOTHING;
```

(If the live `schema_migrations` table has a `rollback` / extra column as used for GE-2B, also store the §8 rollback block there, exactly as the two GE-2B rows did.)

Confirm:
```sql
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20260820000000';
-- expect exactly one row
```

---

## 9. Rollback (if ever needed before enablement)

Full script: [`docs/emergency_rollbacks/PRE_GE2C_20260820000000_online_poker_runtime_rollback.sql`](../emergency_rollbacks/PRE_GE2C_20260820000000_online_poker_runtime_rollback.sql).

Summary — drop in reverse dependency order, then delete the version row:
```sql
DROP FUNCTION IF EXISTS public.op_claim_daily_chips();
DROP FUNCTION IF EXISTS public.op_stand_up(uuid, text);
DROP FUNCTION IF EXISTS public.op_sit_down(uuid, int, bigint, text);
DROP FUNCTION IF EXISTS public.op_get_my_hole_cards(uuid);
DROP FUNCTION IF EXISTS public.op_timeout_sweep();
DROP FUNCTION IF EXISTS public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text);
DROP FUNCTION IF EXISTS public.op_start_hand(jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.op_load_action_context(uuid);
DROP FUNCTION IF EXISTS public.op_is_enabled();
DROP TABLE    IF EXISTS public.online_poker_config;   -- CASCADE not needed: nothing references it
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260820000000';
```
This rollback touches **only** GE-2C objects. It does **not** drop the GE-2B tables (those are a separate, earlier rollback recorded in the GE-2B version rows). Rolling back GE-2C while the flag is false has zero behavioural impact (the runtime was never reachable).

---

## 10. After a successful apply — what's still gated

- **The runtime is still dark.** `enabled = false`. The Edge `online-poker-action` returns `403 disabled` for every request because `op_is_enabled()` is false. No client can deal, sit, or act.
- **Enablement is a separate owner operation:** `UPDATE public.online_poker_config SET enabled = true;` (super_admin only). Do that only when the GE-2D UI is ready and the owner approves a closed-alpha window. Run the full G4 live drill (§7) on a disposable table immediately after.
- **GE-2D UI** (`/poker/*`) can be merged independently; it carries its own `FEATURES.onlinePoker = false` flag and a `RUNTIME_LIVE = false` constant, so it shows a "coming soon" notice and disabled actions regardless of the DB state until both flags are flipped.

---

## Final report template (fill at the end of the apply session)

```
Operation name:            apply_ge2c_online_poker_runtime_rpcs
Target project ref:        orlesggcjamwuknxwcpk
Read/write status:         write (additive: 1 table + 9 functions + 1 trigger + 2 policies)
Objects touched:           online_poker_config, op_is_enabled, op_load_action_context,
                           op_start_hand, op_submit_action, op_timeout_sweep,
                           op_get_my_hole_cards, op_sit_down, op_stand_up, op_claim_daily_chips
Schema migrations changed: YES (1 row: 20260820000000)
deploy_db=true used:       NO
supabase db push used:     NO
pending migrations applied: NO
Runtime enabled:           NO (online_poker_config.enabled = false)
Secrets exposed:           NO
Grant matrix verified:     YES (§6) — write RPCs service_role-only
G3 live proof:             <paste anon/authenticated denied, service_role allowed>
Idempotency re-run:        <2nd apply clean>
Rollback plan:             docs/emergency_rollbacks/PRE_GE2C_20260820000000_*.sql
Next step:                 GE-2D UI merge; then owner-gated enablement + G4 live drill
```
