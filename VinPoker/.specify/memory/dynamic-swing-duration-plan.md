# Implementation Plan: Dynamic Swing Duration

**Branch**: `01-dynamic-swing-duration` | **Date**: 2026-05-27 | **Spec**: `.specify/memory/dynamic-swing-duration-spec.md`

## Summary

Auto-adjust swing duration based on club conditions, dealer fatigue, and historical patterns. DB layer already exists (migration `20260604000000_dynamic_swing_duration.sql` + `calculate_dynamic_swing_duration` RPC + trigger). Edge functions (`process-swing`, `assign-dealer`) still pass fixed config values — need to wire `computeSwingDuration()` into the swing flow.

## Technical Context

- **Language/Version**: TypeScript (Deno for Edge Functions), SQL (PostgreSQL 15+)
- **Primary Dependencies**: Supabase Edge Functions, PostgREST
- **Storage**: PostgreSQL with Supabase
- **Testing**: `supabase functions serve` for local testing, `npm run build` for frontend
- **Target Platform**: Supabase Edge Functions + Vercel (frontend)
- **Constraints**: Minimum 30 min swing duration, no-release invariant, intra-cycle exclusion

## Constitution Check

- **SDD Compliance**: ✅ Spec and plan before implementation
- **No-Release Invariant**: ✅ Duration change doesn't affect release logic
- **Database-First**: ✅ DB layer already exists; edge functions need wiring
- **Supabase Patterns**: ✅ Uses existing RPC pattern, `!attendance_id` disambiguation

## What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| `auto_adjust_duration` column + dynamic params | ✅ Deployed | `20260604000000_dynamic_swing_duration.sql` |
| `calculate_dynamic_swing_duration` RPC | ✅ Deployed | Same migration |
| `trg_calc_swing_due_at` trigger (dynamic on INSERT) | ✅ Deployed | Same migration |
| `computeSwingDuration()` in dealer-utils.ts | ✅ Written, **unused** | `_shared/dealer-utils.ts:474-506` |
| `suggest_swing_config` function | ✅ Deployed | `20260607000000_suggest_swing_config.sql` |

## What Needs to Change

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `supabase/functions/process-swing/index.ts` | Call `computeSwingDuration()` before passing `p_swing_duration_minutes` to `perform_swing` RPC | P0 |
| 2 | `supabase/functions/assign-dealer/index.ts` | Call `computeSwingDuration()` before calculating `swing_due_at` client-side | P1 |
| 3 | `supabase/functions/_shared/dealer-utils.ts` | Add `durationRationale` to `SwingDurationResult`; ensure `evaluateBreakNeed` uses dynamic duration | P1 |
| 4 | `src/components/cashier/DealerSwingTab.tsx` | UI: toggle + config for `auto_adjust_duration`, `base_duration_minutes`, `target_ratio`, etc. | P2 |
| 5 | `src/hooks/useDealerSwing.ts` | Add `SwingConfig` fields for dynamic params | P2 |

## Implementation Order

```
Phase 1 (P0): process-swing wiring
  └── Wire computeSwingDuration → perform_swing

Phase 2 (P1): assign-dealer wiring
  └── Wire computeSwingDuration → swing_due_at calculation
  └── Add durationRationale to SwingDurationResult + log to swing_metrics

Phase 3 (P2): Frontend UI
  └── Toggle + config form for dynamic parameters
  └── i18n keys for new UI strings
```

## Key Technical Decisions

1. **Call `computeSwingDuration()` once per club per cycle** — not per assignment — since club conditions don't change mid-cycle
2. **Fallback**: If `computeSwingDuration` fails, use base `swing_duration_minutes` (no dynamic, no crash)
3. **Fatigue still takes precedence** over dynamic duration — `evaluateBreakNeed` runs after duration calculation
4. **`durationRationale`** logged to `swing_metrics.duration_rationale` as string: `"dynamic:45min|pool_ratio:1.2|base:40min"`
5. **assign-dealer** needs client-side calculation since it's a direct Edge Function call (not a cron)
