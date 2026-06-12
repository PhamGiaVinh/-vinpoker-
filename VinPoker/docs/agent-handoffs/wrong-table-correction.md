# Handoff — Dealer Swing Wrong-Table Correction ("Sửa nhầm bàn")

Status (2026-06-13, PR #33A): labels only. NOT implemented yet.

## What exists now
- Per-table action row: `Nghỉ | Đổi dự kiến | Chốt đổi dealer | Sửa nhầm bàn (disabled)`.
- `Đổi dự kiến` (was "Sửa dealer") = planned-edit only → `ChangePredictedDealerModal` →
  `set_rotation_slot_dealer` (live). Changes the predicted/locked replacement; never
  touches the dealer currently dealing, active `dealer_assignments`, or worked minutes.
- `Sửa nhầm bàn` = disabled placeholder, tooltip "Sắp ra mắt — cần bật Room Reconcile trước".
  No backend call behind it.

## What the real flow needs (PR #33C, after #33B live apply)
- Backend: `reconcile_dealer_room_state` — migration `20260817000002_room_reconcile_corrections.sql`,
  merged source-only (PR #27), **NOT applied live**. The audited design decision (2026-06-13)
  is to REUSE this RPC, not write a new one: the A/B wrong-table swap plans as two MOVEs
  (assigned_at preserved, no credits, no rest impact); the one-sided case releases the
  recorded dealer at `p_effective_at` and assigns the actual dealer backdated to it.
- UI: new `CorrectWrongTableDealerModal.tsx` — wizard: select actual dealer + "đã chia từ lúc"
  (5/10/15 phút quick picks; RPC gate ≤120 min, admin override beyond) → call RPC with
  `p_dry_run=true` (default; lockless, zero writes) → render plan/conflicts as the
  confirmation screen → apply with the CAS echo (`expected_assignment_id`/`expected_version`
  from the dry-run plan) → `race_lost` re-runs the preview.
- Call with NAMED params; `p_displaced` is the 5th parameter. Render results from
  `summary`/`diff`, not raw per-table plan labels.
- If the displaced dealer should become the other table's PREDICTED dealer (not actual),
  chain one `set_rotation_slot_dealer` call after apply.

## Order
1. #33B = controlled live apply of `20260817000002` (separate owner-gated DB session;
   compile preflight → apply exact file → verify RPC/RLS + dry-run writes nothing →
   schema_migrations +1 → rollback note).
2. #33C = modal + wiring (never ship UI calling a missing RPC).
3. #33D = production smoke of a real A/B correction + audit row check.

Full design + audit evidence: session memory `project-wrong-table-correction.md`
(reconcile RPC deep-read, data-model audit, worked-minutes bases, risks).
