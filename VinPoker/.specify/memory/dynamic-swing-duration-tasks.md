# Tasks: Dynamic Swing Duration

**Input**: `.specify/memory/dynamic-swing-duration-spec.md`, `.specify/memory/dynamic-swing-duration-plan.md`

**Prerequisites**: plan.md (required), spec.md (required)

## Phase 1: Wire Edge Functions (P0)

**Purpose**: Connect existing DB layer to Edge Functions — `computeSwingDuration()` is unused

- [ ] T001 Wire `computeSwingDuration()` into `process-swing/index.ts` Pass 3 (both paths: non-pre-assigned line 446, pre-assigned fallback line 393) — replace `clubCfg.swing_duration_minutes` with `computeSwingDuration()` result
- [ ] T002 Wire `computeSwingDuration()` into `assign-dealer/index.ts` — replace static `swingDuration` for `swing_due_at` calculation (line 112)
- [ ] T003 Add `durationRationale` to `SwingDurationResult` in `dealer-utils.ts`; update `computeSwingDuration` to populate it; log rationale to `swing_metrics.duration_rationale`

## Phase 2: Refine DB Layer (P1)

**Purpose**: Polish existing DB functions for real-world use

- [ ] T004 Update `calculate_dynamic_swing_duration` RPC to return `duration_rationale` text alongside `duration_minutes` and `pool_ratio`
- [ ] T005 Ensure `perform_swing` RPC writes `duration_rationale` to `swing_metrics` table
- [ ] T006 Verify `trg_calc_swing_due_at` trigger uses dynamic duration correctly when `swing_due_at` is null on INSERT

## Phase 3: Frontend UI (P2)

**Purpose**: Club admins can toggle auto-adjust and configure dynamic params

- [ ] T007 Add `auto_adjust_duration`, `base_duration_minutes`, `target_ratio`, `min_duration_minutes`, `max_duration_minutes` to `SwingConfig` TypeScript interface in `useDealerSwing.ts`
- [ ] T008 Add toggle + config form UI in `DealerSwingTab.tsx` — enable editing dynamic params
- [ ] T009 Add i18n keys for new UI strings (6 locales)

## Phase 4: Verification

- [ ] T010 Verify `npm run build` succeeds
- [ ] T011 Code review: confirm no-release invariant intact, intra-cycle exclusion preserved, fatigue penalty still applied after dynamic duration

## Dependencies

- **T001 → T003, T006**: T001 blocks T003 (same file), T003 blocks T006
- **T004 → T005**: T004 blocks T005
- **T007 → T008 → T009**: Sequential frontend chain
- **Phase 1, 2, 3**: Can proceed somewhat in parallel (backend vs frontend)

## Implementation Order

1. T001 (process-swing) + T002 (assign-dealer) — core edge function wiring
2. T003 (durationRationale) — logging improvement
3. T004 + T005 + T006 — DB refinements
4. T007 + T008 + T009 — frontend
5. T010 + T011 — verification
