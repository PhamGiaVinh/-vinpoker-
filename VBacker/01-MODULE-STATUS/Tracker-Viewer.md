---
title: Tracker Live Viewer
updated: 2026-07-02
status: LIVE (Phase 2 deferred)
---

# Tracker Viewer Integration

## Current Status
- **Live realtime** LIVE (T1/T3A/T2a/T4 merged)
- **Tracker Undo** #91 APPLIED LIVE (delete_last_action + Edge v10)
- **Hand Input tablet** #82/#81 LIVE (table-map redesign)
- **Tracker Engine Mode** flag OFF, DRAFT #310 (pure engine, HU/3+/settlement)
- **Hole-card visibility** INTENDED (Triton broadcast standard, not a bug)

## Live Components
- `/live/:id` per-action stream
- Public `/live` hub (mobile-first viewer)
- Action Engine inc1+inc2+inc3 LIVE
- Event Hub inc A DRAFT, B/C owner-gated

## Phase 2 (Deferred)
- Evaluator + side-pot logic
- Settlement history
- Multi-table replay

## Risks
- Realtime lag on slow networks
- Hole-card replay visible to all (design requirement, not vulnerability)

## Next
- Owner visual UAT on mobile viewer
- Phase 2 scope + timeline

---
Link: [[MODULE_STATUS]]
