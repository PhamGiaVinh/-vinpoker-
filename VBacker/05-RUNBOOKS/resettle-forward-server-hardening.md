---
title: Resettle-forward — server hardening follow-ups (owner-gated)
updated: 2026-07-09
status: spec / not-yet-applied
money_path: true
---

# Resettle-forward server hardening (Đợt G — follow-ups)

G3 (`trackerResettleForward`) is **LIVE** (#818 UI + #820 flag + #823 hardening). The client
side is protected. Two **server-side** improvements remain — each needs a **migration
(owner-gated apply)** plus a coordinated client follow-up. NOT built yet, on purpose: changing
`apply_resettle_forward`'s signature must be applied **before** any client that calls the new
form, so it can't be safely bundled into one deploy. Both are **defense-in-depth** — the money
path already works and is client-hardened.

## Follow-up A — definitive per-player baseline check (belt for review finding #1, HIGH)

**Problem it closes:** the RPC's conservation guard sums chips over the *changed subset* only,
so a net-zero chip move *among exactly those players* between preview and confirm is invisible
to it. #823 added a **client-side** re-check (re-fetch live chips == engine baseline at confirm).
This follow-up moves that check **inside the RPC under the row lock**, closing the sub-second
TOCTOU the client re-check can't.

**Migration (source-only, backward-compatible):**
1. `DROP FUNCTION IF EXISTS public.apply_resettle_forward(uuid,uuid,text,jsonb,jsonb,jsonb);`
2. `CREATE OR REPLACE FUNCTION public.apply_resettle_forward(... same 6 args ...,
   p_expected_current jsonb DEFAULT NULL)` — inside the existing `FOR UPDATE` loop over
   `p_final_stacks`, if `p_expected_current` is non-null, look up each changed player's expected
   value and `RETURN jsonb_build_object('ok',false,'error','stale_state')` when
   `v_cur <> expected`. When NULL → behave exactly as today (so the current 6-arg client keeps
   working after the migration is applied).
3. Re-`GRANT EXECUTE` to `authenticated, service_role`; `REVOKE` from `PUBLIC, anon`.

**Client follow-up (AFTER the migration is applied):** in `resettleApply.buildApplyResettleArgs`
add `p_expected_current` = `[{player_id, entry_number, chip_count: before}]` from
`resettleChipChanges`, and handle `error==='stale_state'` like the existing drift abort. Do NOT
ship this client change until the migration is live (a 7-arg call to the old function = 42883).

**Verify:** `has_function_privilege('anon', ...)=false`; 6-arg call still succeeds; a call with a
deliberately-wrong `p_expected_current` returns `stale_state` and writes nothing.

## Follow-up B — propagate later-hand `starting_stack` (review finding #11, MEDIUM)

**Problem it closes:** the RPC updates later hands' `hand_players.ending_stack` but not
`starting_stack`, so a later hand's recorded delta (`ending - starting`) becomes internally
inconsistent. Live money is correct; the only victim is a **second** resettle on an
already-resettled chain (it reads the stale `starting_stack` and mis-carries). Rare, but real.

**3-part coordinated change (all or nothing):**
- Engine (`resettleForward.ts`): also emit `before_starting/after_starting` for each later-hand
  player whose incoming stack changed.
- Mapping (`resettleApply.buildApplyResettleArgs`): include `starting_stack` in the
  `p_hand_changes` rows.
- RPC: when a `p_hand_changes` row carries `starting_stack`, `UPDATE hand_players SET
  ending_stack = ..., starting_stack = ...` (keep it optional/backward-compatible).

## Ordering & safety
- Apply the migration in a controlled session ([[CONTROLLED_DB_APPLY]]) — owner phrase required.
- Migrations are backward-compatible → applying them alone changes nothing observable (the live
  6-arg client ignores the new capability). The client follow-ups activate them.
- Do NOT `db push`/`reset`/`migration up`. Source-only files + one-shot owner-gated apply.

Source of findings: 36-agent adversarial review, 2026-07-09 (11 confirmed / 15). See
[[project-resettle-forward-g3-ui]].
