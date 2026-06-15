# GE-2M — Controlled Apply Preflight (read-only, owner-gated)

**Status: PREFLIGHT ONLY. Nothing applied, deployed, scheduled, or enabled. Online poker DARK.**
This is the read-only go/no-go check for a *future* owner-gated apply session (GE-2N) that would
apply the three merged-but-unapplied GE migrations. No DB apply, no Management-API write, no
`db push`, no `deploy_db`, no Edge deploy, no cron, no flag flip, no `schema_migrations` write.

Base: `origin/main` @ `3c5ed12` (#232). Companions: `GE2L_APPLY_ORDERING_READINESS.md`,
`GE2_ENABLEMENT_RUNBOOK.md`, `GE2_PHASE_D_READINESS.md`.

---

## 1. Preflight table

| # | Check | Method | Result |
|---|---|---|---|
| 1 | `origin/main` fetched | git | ✅ top = `3c5ed12` (#232) |
| 2 | No duplicate 14-digit migration version | source | ✅ none |
| 3 | Live `schema_migrations` max is before the GE migrations | **LIVE (deferred)** | ⏳ last-verified live max = `20260820000002` (< `20260907…`); **re-confirm live at GE-2N** (read-only Mgmt API, rotated creds) |
| 4 | GE-2I/2J/2K migration files on main | source | ✅ all 3 present |
| 5 | Rollback snapshots present | source | ✅ all 3 present |
| 6 | Migration classification | source | ✅ function-only + grants (see §2) |
| 7 | Table-runner Edge in deploy workflow? | source | ✅ **NOT** in the 7-fn list → undeployed |
| 8 | Runner cron in source/live? | source (+live deferred) | ✅ none in source; timeout-sweep cron `20260903000000` is source-only/unapplied; **live cron re-confirm at GE-2N** |
| 9 | Flags dark | source (+live deferred) | ✅ `onlinePoker=false`, `RUNTIME_LIVE=false`, `online_poker_config.enabled` DEFAULT false; **live `enabled` re-confirm at GE-2N** |
| 12 | Phase D gates still required | — | ✅ 2 disposable logins + exact phrase still required (see §7) |

**Cannot be checked this session (no live creds; secrets just rotated, none in chat):** #3, #8-live,
#9-live. These are the **first read-only step of GE-2N** — not a blocker to preflight.

---

## 2. Migration classification

| Migration | Object(s) | Statement type | Idempotent | Table DDL | Apply-time data write | Cron | Flag flip | Grants |
|---|---|---|---|---|---|---|---|---|
| **GE-2I** `20260907000000` | `op_submit_action` | `CREATE OR REPLACE FUNCTION` | yes | none | **none** | none | none | `REVOKE`+`GRANT` → service_role |
| **GE-2J** `20260908000000` | `op_stand_up` | `CREATE OR REPLACE FUNCTION` | yes | none | **none** | none | none | `REVOKE`+`GRANT` → authenticated+service_role |
| **GE-2K** `20260911000000` | `op_run_due_table_ticks`, `op_table_runner_diag` | 2× `CREATE OR REPLACE FUNCTION` | yes | none | **none** | none | none | `REVOKE`+`GRANT` → service_role |

Each migration is **one transaction** (`BEGIN … COMMIT`) wrapping only function definitions + grant
re-asserts. Verified top-level statements: `BEGIN` · `CREATE OR REPLACE FUNCTION` · `REVOKE` ·
`GRANT` · `COMMIT` — **no** `CREATE/ALTER TABLE`, **no** top-level `INSERT/UPDATE/DELETE`, **no**
`cron.schedule`, **no** `online_poker_config` write. Applying them changes **only** function bodies
+ ACLs; the runtime stays dark (`enabled=false`).

> The `UPDATE` statements inside `op_submit_action`/`op_stand_up` are part of the function **body**
> (runtime behavior when the function is *called*) — they are **not** executed at apply time, and
> while dark the functions are never called.

---

## 3. Exact apply order (GE-2N — owner-gated, NOT now)

Apply **single-file, one at a time, via Management API** (the GE-2B/2C/N2 process). Flag stays OFF.

1. `20260907000000` — **GE-2I** settlement seat writeback
2. `20260908000000` — **GE-2J** op_stand_up folded guard
3. `20260911000000` — **GE-2K** table-runner lister + diag

Per migration: **preflight → snapshot live body → apply ONLY this file → verify live body → record
version row (`statements[]` + `rollback[]`) → rollback note.** Order rationale: GE-2J's correctness
depends on GE-2I's writeback; GE-2K depends on both. Version order satisfies it; each is idempotent
(`CREATE OR REPLACE`) so re-apply is safe.

> ⛔ **NEVER use `supabase db push` / `deploy_db=true` for this.** That applies **all** pending
> migrations (`--include-all`), which would replay the risky chain `20260801→20260813` **and** the
> unrelated dealer-swing/finance/**payroll** migrations (`0826…0911`) in one shot. Apply **only**
> these 3 engine files individually.

---

## 4. Rollback order (reverse: `0911 → 0908 → 0907`)

| Revert step | Rollback file | Effect |
|---|---|---|
| GE-2K | `PRE_GE2K_20260911000000_*_rollback.sql` | DROP `op_run_due_table_ticks` + `op_table_runner_diag` |
| GE-2J | `PRE_GE2J_20260908000000_*_rollback.sql` | restore `20260820000000` `op_stand_up` body |
| GE-2I | `PRE_GE2I_20260907000000_*_rollback.sql` | restore `20260820000002` `op_submit_action` body |
| full runtime | `PRE_GE2C_20260820000000_*` (+ N2 `PRE_GE2C_N2_20260820000002_*`) | full GE-2C runtime revert |

Each apply also records its own `rollback[]` in the version row.

---

## 5. Runtime verification plan (per migration, post-apply, while dark)

- **GE-2I:** `pg_get_functiondef(op_submit_action)` contains the writeback block
  `IF p_new_state->>'status' = 'complete' THEN UPDATE online_poker_seats … AND s.user_id = hs.user_id`;
  all G4 backstops present (idempotency, CAS, seat-ownership, chip-conservation post-sum filtered);
  grant matrix = service_role only; idempotent re-run = no change.
- **GE-2J:** `pg_get_functiondef(op_stand_up)` guard status set = `('active','folded','allin')`;
  grant = authenticated + service_role; idempotent re-run.
- **GE-2K:** both functions in `pg_proc`, `SECURITY DEFINER` + `search_path=public`, `EXECUTE`
  service_role only (anon/authenticated absent); `op_run_due_table_ticks(50)` and
  `op_table_runner_diag(200)` return `{outcome:'disabled',tables:[]}` (safe to call live — dark gate).
- **After all 3:** live `schema_migrations` max = `20260911000000`; `online_poker_config.enabled`
  still `false`; no online-poker cron; FE flags untouched.

---

## 6. Live re-confirms owed at GE-2N start (read-only, rotated creds, NOT chat)

- `schema_migrations` max (expect `20260820000002` before apply).
- `online_poker_config.enabled = false`.
- `cron.job`: no online-poker runner/sweep job scheduled.
- (optional) `supabase functions list`: table-runner / timeout-sweep edges not deployed.

---

## 7. Phase D gates (still required — applying ≠ enabling)

Applying GE-2I/2J/2K (GE-2N) does **not** enable online poker. Enabling is a separate, later step
behind ALL of:

1. DB password rotated (**owner reports done**) + present locally for the drill.
2. **Two disposable test logins.**
3. Owner sends the EXACT phrase: **`Proceed with G4 DB enable drill`.**

🔐 All previously-exposed secrets (Supabase Mgmt PAT, service secret, Vercel token, Google/AQ token,
DB password) must remain rotated; never paste new keys into chat.

---

## 8. Risks / blockers

- **Risk: LOW.** All three are idempotent, function-only, dark migrations with tested rollbacks; no
  table/data/cron/flag change at apply time.
- **Key guardrail:** the live apply (GE-2N) must be **single-file Management-API apply of ONLY
  `0907`/`0908`/`0911`** — **never** `db push`/`deploy_db` (which would also apply the unrelated
  dealer-swing/finance/payroll migrations `0826…0911` and the risky `0801→0813` chain).
- **Soft blocker to GE-2N:** the live re-confirms (§6) need the rotated creds in the keyring (not
  chat). Until then, no live apply.

---

## 9. Verdict

**Source-side preflight: ALL PASS.** Ready for an owner-gated **GE-2N controlled apply** session,
contingent on (a) the §6 live read-only re-confirms at GE-2N start, (b) rotated creds in the
keyring, (c) single-file Management-API apply only. **Enable stays gated behind Phase D** (2
disposable logins + the exact phrase). Nothing in GE-2M applies, deploys, schedules, or enables.
