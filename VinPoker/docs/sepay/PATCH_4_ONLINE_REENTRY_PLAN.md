# PATCH 4 — Player-facing online tournament RE-ENTRY (dynamic VietQR + full-auto re-seat)

Focused build doc (per reviewer). The long session plan has many patches; build ONLY PATCH 4 from here.

## Current live state (2026-06-29)
- VietQR Stage 1/2 LIVE (`dynamicVietQr=true`): online INITIAL registration shows a dynamic VietQR; SePay
  full-auto confirms exact matches via the system bot (`sepay_system_settings.system_actor_id`,
  impersonated around `confirm_registration_and_assign_seat` in `settle_bank_transaction`,
  `20261118000000`). Production-validated.
- Re-entry today = cashier-only, cash-at-counter, immediate-confirm (`reenter_tournament_player`,
  `20260901000001`), UNAPPLIED, flag `registrationExtensions=false`. No online pay-first path.

## Why / goal
A busted player the FLOOR removed should buy back in themselves, online: tap "Mua lại" → dynamic REENTRY
VietQR → pay → **auto re-seated, no cashier** (owner-chosen FULL-AUTO). Window: allowed while
`current_level IS NULL OR current_level <= COALESCE(late_reg_close_level,6)`.

## Two structural facts (handled)
- **Floor-sync gap:** floor "Loại" (`tournament-live-draw` `update_seats`) sets `tournament_seats.is_active=false`
  → BEFORE trigger sets seat `status='busted'`, but NOT `tournament_entries.status`. → STAGE A mirrors it.
- **`uniq_treg_active`** (`20260503115456:29-31`) blocks a 2nd pending reg for a player who still holds a
  confirmed reg. → STAGE B replaces it with re-entry-aware uniques.

## Gates (all must hold to auto-confirm a re-entry)
SEPAY_AUTO_CONFIRM env · DB `auto_confirm_enabled` · bot ∈ `club_cashiers` of the resolved club · exact match
(REENTRY code + amount==total_pay) · `api_verified_at` · transfer_type='in' · reg pending · **re-entry gate:
source entry busted (floor-removed) + no active seat + window open** — re-validated AT CONFIRM time.

## Stages (each source-only, owner-gated apply, own review)
- **A (PREREQUISITE):** `20261120000000_floor_bust_syncs_entry.sql` — AFTER-UPDATE-OF-is_active trigger on
  tournament_seats; WHEN `OLD.is_active AND NOT NEW.is_active AND NEW.status='busted'`; body (EXCEPTION WHEN
  OTHERS THEN NULL — never blocks the seat UPDATE) sets the entry busted iff no surviving active seat (move-proof
  via status='busted' + no-active-seat). Test `floor_bust_syncs_entry_test.sql`.
- **B:** `20261121000000_treg_source_entry_id.sql` — add `tournament_registrations.source_entry_id uuid` +
  replace `uniq_treg_active` with `uniq_treg_active_initial` (WHERE source_entry_id IS NULL) +
  `uniq_treg_pending_reentry_per_entry` (WHERE source_entry_id IS NOT NULL). New edge fn
  `functions/tournament-reentry/index.ts` (clone of tournament-register): gate (eliminated + no active seat +
  window open + no existing pending REENTRY) → PENDING reg (REENTRY code, total_pay=buy_in+rake+service_fee,
  source_entry_id set, NO free-rake) → returns the same shape as tournament-register (modal + VietQR unchanged).
- **C:** extract `reenter_tournament_player` seat steps 8-14 into a SHARED helper `_assign_reentry_seat(...)`
  (both the cashier RPC and the new confirm CALL it — no paste). `20261121000001_confirm_reentry_and_assign_seat.sql`
  mirrors confirm (guards 2.4/2.5) for the pay-first shape, re-validates the gate, calls the helper, flips the
  pending reg → confirmed. `20261122000000_sepay_settle_reentry_autoconfirm.sql` = CREATE OR REPLACE
  settle_bank_transaction off the `20261118000000` byte-baseline; ONLY the exact-match confirm dispatch changes
  (`source_entry_id IS NULL → confirm_registration_and_assign_seat` UNCHANGED, else `confirm_reentry_and_assign_seat`).
  Add safeguard partial unique `payment_settlements (tournament_registration_id) WHERE outcome='auto_confirmed'`.
- **D:** flag `dynamicReentry` (default OFF) + "Mua lại" CTA (TournamentDetail / RegisteredBadge when busted +
  no active seat + window open; near-threshold warning) + TournamentRegisterModal `mode='reentry'`.

## Migration order
A `20261120000000` → B `20261121000000` → C `20261121000001` + `20261122000000`. All controlled-apply (no db push).

## Verification (owner-run)
A: `floor_bust_syncs_entry_test.sql` (bust→busted, move→seated, null→fallback, no-raise).
C: clone `sepay_auto_confirm_sandbox_test.sql` → re-entry headless (auto_confirmed + new seat + entry_no++ +
confirmed_by=bot; **double-pay same reg → 1 seat + 1 flag**; gates-off/amount-mismatch/no-table/window-closed→flag;
double-run→already_settled) + RE-RUN the initial-path test (VINReg must still pass — drift guard).

## Rollback
A: DROP TRIGGER + FUNCTION. B: drop column + restore `uniq_treg_active` (only after no re-entry rows).
C: CREATE OR REPLACE settle back to the `20261118000000` body (instant). D: flag false.

## Hard-NOs
No edit to `confirm_registration_and_assign_seat`. No direct status flip to 'confirmed' (always via a confirm
RPC). No production enable / no db push / no deploy without owner. No delete of the bot auth.users row. No
auto-confirm without exact match + api_verified_at + the 3 gates. No free-rake on re-entry. UI/ledger renders
`confirmed_by` as "Hệ thống SePay", never the bot email/uuid.
