# PATCH 4 / STAGE C — controlled apply + rollback runbook (money path)

STAGE C re-touches the production-validated `settle_bank_transaction`. Apply ONLY in a controlled owner session.
**Nothing here is executed by this PR** — no apply, no deploy, no flag, no cron.

## Files (STAGE C)
- `supabase/migrations/20261122000001_confirm_reentry_and_assign_seat.sql` — shared `_assign_reentry_seat`
  helper + `reenter_tournament_player` refactor (calls the helper) + `confirm_reentry_and_assign_seat`.
- `supabase/migrations/20261123000000_sepay_settle_reentry_autoconfirm.sql` — `settle_bank_transaction`
  CREATE OR REPLACE off the `20261118000000` baseline; ONLY the exact-match confirm dispatch changes; +
  `uniq_payment_settlements_autoconfirm_per_reg`.
- `scripts/diagnostics/sepay_reentry_auto_confirm_sandbox_test.sql` — headless test (9 cases: happy ·
  3 guard-flags with reason asserted · amount mismatch · sequential double-pay · INITIAL regression ·
  confirm idempotency · table-full seating-failed).

## ⚠️ Apply order (STRICT, NON-BYPASSABLE — all of B+C in ONE controlled session, in this exact order)

**Why the order is load-bearing (P1-3, STAGE C review).** STAGE B alone adds `source_entry_id`, DROPs
`uniq_treg_active`, and creates `uniq_treg_pending_reentry_per_entry` — which immediately *allows* a pending
re-entry reg (`source_entry_id NOT NULL`) to exist. But until the STAGE C settle (`20261123000000`) is applied,
the LIVE settle is still baseline `20261118000000`, which ALWAYS calls `confirm_registration_and_assign_seat` —
ignoring `source_entry_id`, **skipping the busted/window re-entry guards** (it still enforces one-active-seat, so
no double-seat, but a re-entry could auto-confirm after the window closed or against a non-busted source). So
B-applied-without-C-settle is a guard-bypass window. **Close it by never splitting B and C, and by keeping the
re-entry reg-creation path dark until the settle is live** (no pending re-entry reg can exist → the window is
empty even mid-apply).

Run **all of the following in one session, top to bottom — do not stop between steps:**

0. **(pre-apply) Owner / SECURITY DEFINER owner-consistency check.** The shared helper `_assign_reentry_seat`
   REVOKEs ALL and is reachable only because its two SECURITY DEFINER callers run as the function OWNER. This
   holds only if all three functions share ONE owner. Before applying, confirm the migration role owns the
   existing functions (and will own the new ones), e.g.:
   ```sql
   SELECT p.proname, r.rolname AS owner
   FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.proname IN ('reenter_tournament_player','confirm_registration_and_assign_seat','settle_bank_transaction')
   ORDER BY 1;
   ```
   All three must report the SAME owner. After apply, re-run including `_assign_reentry_seat` +
   `confirm_reentry_and_assign_seat` and confirm the owner matches; if any differs, `ALTER FUNCTION … OWNER TO
   <migration_role>` to align (the SECURITY DEFINER → helper privilege chain breaks at runtime otherwise).
1. Apply STAGE B `20261122000000_treg_source_entry_id.sql` (column + index swap).
2. Apply STAGE C `20261122000001_confirm_reentry_and_assign_seat.sql` (helper + reenter refactor + confirm).
3. Apply STAGE C `20261123000000_sepay_settle_reentry_autoconfirm.sql` (settle dispatch + `FOR UPDATE` belt).
4. Run the headless tests in a controlled session (BEGIN…ROLLBACK):
   - `floor_bust_syncs_entry_test.sql` (STAGE A) → 5 PASS.
   - `sepay_reentry_auto_confirm_sandbox_test.sql` (STAGE C) → **9 PASS** (incl. double-pay → 1 seat + 1 flag,
     the 3 guard flags asserting their specific reason, confirm idempotency, table-full → flagged_seating_failed,
     and the INITIAL-path regression).
5. Only AFTER 1–4 succeed: deploy the `tournament-reentry` edge function (see below).
6. Only LATER (its own owner-gated step): build/ship UI STAGE D and flip `dynamicReentry` (default OFF) +
   per-club opt-in.

**The re-entry Edge function MUST stay UNDEPLOYED and the `dynamicReentry` flag MUST stay OFF until the STAGE C
settle (`20261123000000`) is live.** Nothing may create a pending re-entry reg before then. This is the
operational guarantee that the B-without-C-settle window (above) is never actually entered.

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
- Do NOT apply STAGE B without the STAGE C settle in the SAME session, and do NOT deploy `tournament-reentry`
  or flip `dynamicReentry` until `20261123000000` is live (else re-entry regs route through the INITIAL confirm
  and bypass the busted/window guards — see Apply order, P1-3).
- Do NOT re-own `_assign_reentry_seat` to a different role than its SECURITY DEFINER callers (breaks the
  internal-only privilege chain at runtime — see Apply order step 0).
- Re-entry pays FULL (buy_in + rake + service_fee) — never consumes a free-rake slot.
- `confirmed_by` (the bot uid) renders in UI/ledger as **"Hệ thống SePay"**, never the bot email/uuid.
