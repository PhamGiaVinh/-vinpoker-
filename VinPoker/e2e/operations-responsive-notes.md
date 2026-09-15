# Operations responsive repair — 2026-09-15

Baseline: `ab624b250088eca500a4bed1030689f6f17d2bbb`.

## Scope delivered

- Floor mode choices respond to available panel width, including a 320px desktop sidebar.
- Legacy and V3 Floor sheets retain dynamic viewport height and contained vertical scrolling.
- Roster has a shrinkable container, nine rows, and reachable last seat.
- Chip metric cards size by available width instead of forcing five narrow columns.
- Long names wrap; large values are tested to stay on one line at the fixture's supported range.
- Dealer action popover fits viewport bounds and can scroll; module tabs wrap and have 44px height.
- Existing self-hosted Vietnamese typography is scoped to operational screens and affected portals.
- No RPC, mutation, permission, feature flag, DB, Edge or production deployment changes.

## Verification

Playwright uses local synthetic responses at `127.0.0.1:54321`. This is UI evidence,
not live backend synchronization proof. Viewports: 360, 390, 411, 768, 1024, 1280, 1920.
The fixture HTML/TSX lives only under e2e and is not a Vite production entry.
Screenshots: `test-results/ops-responsive/` (local output, not committed).

The owner's serve-sim ZIP was read. It requires macOS/Xcode and cannot execute on
this Windows host. No package was installed. No Safari/iPhone hardware claim.

## Remaining runtime work — not hidden by UI polish

The previously captured production Floor and Dealer images do not establish a shared
V3 inventory. `FEATURES.floorTableControlV3` selects the session-backed path. The
production workflow obtains build variables with `vercel env run`; absence of literal
V3 variables in YAML does NOT establish their live value. Verify the exact deployed
artifact/flags and authenticated inventory reads before concluding the runtime cause.

No activation is included here. Cross-screen Floor/Tracker/Dealer session convergence,
buy-in to physical inventory reconciliation, and end-to-end chip/payout synchronization
remain NOT MEASURED in this UI pass. Do not claim they were repaired by these styles.
Existing table ownership, mode restrictions, and money gates are unchanged.
