# Marketing MVP — Apply Runbook (owner-gated)

This module ships **source-only** and **flag-OFF** (`FEATURES.marketingModule = false`). Nothing
runs in production until an owner applies the migrations, deploys the Edge function, schedules the
cron, and flips the flag. Apply the steps **in this exact order** — the cron MUST be last.

> Scope: club-scoped `marketing` role + compose → schedule → auto-dispatch. **P0 is Telegram-only**
> (Facebook/Zalo are a later phase). Marketers **direct-publish**, but a **compliance hard-block**
> runs at schedule time.

## Order of operations

1. **Apply the enum migration ALONE first** — `20261101000000_app_role_add_marketing.sql`.
   Postgres cannot use a newly-added enum value in the same transaction that adds it, so this must
   commit on its own. Do NOT bundle it into one `BEGIN` with the role migration.
2. **Verify the enum** contains `marketing`:
   ```sql
   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'app_role' ORDER BY e.enumsortorder;  -- expect 'marketing' present
   ```
3. **Apply the role migration** — `20261101000001_marketing_role.sql`
   (`club_marketers` table + `is_club_marketer` + `marketer_club_ids` + owner-gated grant/revoke).
   Run its in-file TEST block in a transaction and `ROLLBACK`.
4. **Apply the core migration** — `20261101000002_marketing_core.sql`
   (enums, `marketing_posts` / `post_channel_status` / `club_channel_integrations` /
   `marketing_blocked_terms` + seed, all RPCs). Run its in-file TEST block in a transaction and
   `ROLLBACK`. Confirm:
   - clients cannot `UPDATE marketing_posts` directly (no broad UPDATE policy);
   - `marketing_claim_due_posts` / `marketing_record_channel_result` / `marketing_finalize_post`
     are **EXECUTE-able by `service_role` only** (revoked from `authenticated`/`anon`/`PUBLIC`);
   - `marketing_schedule_post` blocks a post containing a seeded term (e.g. "cá độ").
5. **Regenerate `types.ts`** in a separate step (optional for runtime — the UI uses a loosely-typed
   client — but recommended so future edits are type-checked).
6. **Deploy the `marketing-dispatch` Edge function** via the Edge deploy workflow. Confirm the
   project has the `TELEGRAM_BOT_TOKEN` Edge secret (already used by the existing Telegram functions).
7. **Dry-invoke** the Edge function with no due posts → expect `{"outcome":"no_posts"}` and zero errors.
8. **Apply the cron migration LAST** — `20261101000003_schedule_marketing_dispatch.sql`.
   If you schedule it before steps 4/6 succeed, the cron will fail every minute.
9. **Create a test scheduled post** (a club whose `club_settings.telegram_chat_id` is set):
   compose → schedule `now` → wait one cron tick → confirm Telegram delivery and
   `post_channel_status.status = 'sent'`, `marketing_posts.status = 'sent'`.
10. **Keep `FEATURES.marketingModule = false`** on `main`/production. Run owner UAT on a preview
    branch with the flag ON; only flip the flag on production after UAT passes.

## Telegram config — single source of truth
P0 Telegram uses the **global** `TELEGRAM_BOT_TOKEN` Edge secret + the club's
`club_settings.telegram_chat_id`. The schedule check, the enabled-channel list, and the dispatcher
all read `club_settings.telegram_chat_id` — there is no second source. A club is "Telegram-ready"
once its `telegram_chat_id` is linked (via the existing Telegram bot in club settings).

## Tokens — never in the UI / never in git
`club_channel_integrations.secret_ref` is a **key NAME pointer** restricted to a fixed allowlist
(`TELEGRAM_BOT_TOKEN` / `FACEBOOK_PAGE_TOKEN` / `ZALO_OA_TOKEN`); the real token lives only in
Supabase Secrets/Vault and is read inside the Edge function via `Deno.env.get`. The P0 UI does not
accept any token/secret input.

## Rollback
Each migration has an in-file ROLLBACK block. Cron: `SELECT cron.unschedule('marketing-dispatch');`.
Code kill-switch: set `FEATURES.marketingModule = false` and redeploy (objects stay but inert).
