# Live DB Rules (Supabase)

Load whenever the task touches Supabase / Postgres / migrations / RPCs / Edge Functions / deploy.
Production project ref: **`orlesggcjamwuknxwcpk`**. Default mode is **read-only**.

## Forbidden by default (owner-gated)

Never run these except inside an owner-approved controlled runbook **with the exact owner phrase**:

```
supabase db push
supabase db reset --linked
supabase migration up --linked
supabase functions deploy        (production Edge deploy)
vercel --prod                    (production frontend deploy)
deploy_db=true                   (CI database deploy)
destructive SQL: DROP TABLE / DROP SCHEMA / TRUNCATE / unscoped DELETE/UPDATE on public.*
```

Migration state note: the risky chain `20260801 → 20260813` must **not** be replayed; live max is
far behind merged source-only migrations, so a blind `db push` would fail on drift. Migration
reconciliation is a **separate, dedicated, owner-approved session** — not folded into feature work.

## The safety hook (mandatory)

A deny-first `PreToolUse` hook, `vinpoker-safety-guard.ps1`, inspects every shell command and
**denies** the dangerous patterns above **even if the allowlist permits them** (it is a compensating
control). It is registered user-globally so it fires in every session and every `D:/wt/*` worktree.

- **It is not optional.** Do not remove, weaken, bypass, or comment it out without explicit owner
  approval.
- It is **fail-open**: any parse/exec error → allow, so a hook bug never bricks the workflow. Only an
  explicit dangerous-pattern match denies.
- It does **not** block `supabase db query --linked` — that is the legitimate read/controlled-apply
  path, gated by runbook + owner phrase, not by the hook.
- **Do not put blocked-command literals in shell commands** (commit messages, `echo`/`grep` tests):
  the hook matches the literal substring and will deny the whole call. Use variables or paraphrase
  when documenting or committing about blocked commands.

Hook script (canonical, version-tracked): `.claude/hooks/vinpoker-safety-guard.ps1`.
Runtime copy used by the global registration: `%USERPROFILE%\.claude\hooks\vinpoker-safety-guard.ps1`.
Registration: `~/.claude/settings.json` → `hooks.PreToolUse` (matchers `Bash`, `PowerShell`,
absolute path — never `${CLAUDE_PROJECT_DIR}`).

## Controlled apply model (CRITICAL mode)

When an apply is genuinely required and the owner has approved with the exact phrase, every step is
explicit:

```
1. Operation name + target project ref
2. Preflight query (verify current live object/state)
3. Snapshot/evidence (pg_get_functiondef, policy/grant dump) if changing functions/policies/schema
4. Single-purpose SQL or one approved migration only (no broad refactor)
5. Verify-before
6. Apply
7. Verify-after (re-read the live body / row counts)
8. Rollback note
9. Final report
```

## Required final DB report lines

```
Operation name:
Target project ref:
Read/write status:
Objects touched:
schema_migrations changed:   [expected NO]
deploy_db=true used:         [expected NO]
supabase db push used:       [expected NO]
pending migrations applied:  [expected NO]
secrets exposed:             [expected NO]
Verification result:
Rollback plan:
Next step:
```

Never edit old migrations. Create a new migration; check for version-slot collisions first
(`git fetch` + inspect `supabase/migrations/`). Use idempotent, defensively-written SQL. Treat
`src/integrations/supabase/types.ts` as the schema source of truth (live DB has drifted from
migrations).
