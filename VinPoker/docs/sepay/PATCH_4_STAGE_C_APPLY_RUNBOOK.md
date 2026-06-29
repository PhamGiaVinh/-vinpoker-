# PATCH 4 / STAGE C — controlled apply + rollback runbook (money path)

STAGE C re-touches the production-validated `settle_bank_transaction`. Apply ONLY in a controlled owner session.
**Nothing here is executed by this PR** — no apply, no deploy, no flag, no cron.

## Files (STAGE C)
- `supabase/migrations/20261122000001_confirm_reentry_and_assign_seat.sql` — shared `_assign_reentry_seat`
  helper + `reenter_tournament_player` refactor (calls the helper) + `confirm_reentry_and_assign_seat`.
- `supabase/migrations/20261123000000_sepay_settle_reentry_autoconfirm.sql` — `settle_bank_transaction`
  CREATE OR REPLACE off the `20261118000000` baseline; ONLY the exact-match confirm dispatch changes; +
  `uniq_payment_settlements_autoconfirm_per_reg`.
- `scripts/diagnostics/sepay_reentry_auto_confirm_sandbox_test.sql` — headless test (7 cases).

## ⚠️ Apply order (STRICT — the settle dispatch must exist before any re-entry payment can land)
1. Apply STAGE B `20261122000000_treg_source_entry_id.sql` (column + index swap).
2. Apply STAGE C `20261122000001_confirm_reentry_and_assign_seat.sql`.
3. Apply STAGE C `20261123000000_sepay_settle_reentry_autoconfirm.sql`.
4. Run the headless tests in a controlled session (BEGIN…ROLLBACK):
   - `floor_bust_syncs_entry_test.sql` (STAGE A) → 5 PASS.
   - `sepay_reentry_auto_confirm_sandbox_test.sql` (STAGE C) → 7 PASS (incl. double-pay → 1 seat + 1 flag,
     and the INITIAL-path regression).
5. Deploy the `tournament-reentry` edge function (see below).
6. Only THEN build/ship UI STAGE D (flag `dynamicReentry`, default OFF).

**Edge-fn deploy — confirm the mechanism first.** `tournament-register` is NOT in
`.github/workflows/vbackerworkflowmain.yml`'s explicit deploy list, so functions are likely auto-deployed by
the platform on merge. **Implication:** if functions auto-deploy, `tournament-reentry` goes live the moment its
source (STAGE B) reaches `main` — so **do not merge STAGE B before STAGE C's settle is applied**, or a re-entry
payment could hit the OLD settle (which would route a re-entry reg through `confirm_registration_and_assign_seat`,
bypassing the re-entry gate). Safe path: **merge B+C together**, then apply migrations in the order above. If
functions are deployed explicitly instead, the manual command (mirrors `tournament-register`'s player-auth model
— a real user JWT, so default verify_jwt, NOT `--no-verify-jwt`):
```
supabase functions deploy tournament-reentry
```
Do NOT execute it here; owner runs it as step 5.

## Rollback (separate from apply — never run during apply)
- **settle** (`20261123000000`): `CREATE OR REPLACE` `settle_bank_transaction` back to the `20261118000000`
  body (instant, no DDL) → re-entry dispatch gone, initial path unaffected; then
  `DROP INDEX IF EXISTS public.uniq_payment_settlements_autoconfirm_per_reg;`.
- **confirm** (`20261122000001`): `DROP FUNCTION IF EXISTS public.confirm_reentry_and_assign_seat(uuid,uuid,text);`
  + `DROP FUNCTION IF EXISTS public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer);` + `CREATE OR
  REPLACE` `reenter_tournament_player` back to its `20260901000001` body.
- **STAGE B** (`20261122000000`): only after no re-entry rows exist — drop the two new indexes, recreate
  `uniq_treg_active`, `ALTER TABLE public.tournament_registrations DROP COLUMN source_entry_id`.
- Edge fn: `supabase functions delete tournament-reentry` (or leave it — inert without the confirm path).

## Hard-NOs
- Do NOT edit `confirm_registration_and_assign_seat` (the INITIAL path stays byte-identical).
- Do NOT flip a registration to 'confirmed' directly — always via a confirm RPC (which also draws the seat).
- No production enable / no `supabase db push` / no deploy / no flag flip without explicit owner action.
- Do NOT delete the SePay system-bot `auth.users` row.
- No auto-confirm without: exact match + `api_verified_at` + the 3 gates (env + DB switch + club opt-in).
- Re-entry pays FULL (buy_in + rake + service_fee) — never consumes a free-rake slot.
- `confirmed_by` (the bot uid) renders in UI/ledger as **"Hệ thống SePay"**, never the bot email/uuid.
