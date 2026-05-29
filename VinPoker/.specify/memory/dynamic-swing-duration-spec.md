# Feature Specification: Dynamic Swing Duration

**Feature Branch**: `01-dynamic-swing-duration`

**Created**: 2026-05-27

**Status**: Draft

**Input**: User description: "Dynamic Swing Duration — auto-adjust swing duration based on club conditions, dealer fatigue, and historical patterns instead of fixed values."

## User Scenarios & Testing

### User Story 1 - Club Admin Seeks Auto-Adjusted Swing Durations (Priority: P1)

As a club admin, I want swing durations to automatically adjust based on current club conditions (peak hours, dealer availability, table demand) so that tables are optimally staffed without manual recalculations.

**Why this priority**: Core value proposition — automation replaces manual adjustment, directly impacting club operations.

**Independent Test**: Can be tested by observing that different swing assignments receive different duration values based on club conditions, verified via `swing_metrics` table entries.

**Acceptance Scenarios**:

1. **Given** a club with 10+ active dealers and peak historical usage at 20:00-23:00, **When** a swing is scheduled during peak hours, **Then** the swing duration is shorter (e.g., 30-45 min) to allow faster rotation
2. **Given** a club with low dealer count (3-4 active), **When** a swing is scheduled, **Then** duration factors in limited replacement pool

---

### User Story 2 - Dealer Receives Fatigue-Aware Scheduling (Priority: P1)

As a dealer, I want swing durations to account for my worked minutes so that I get a break when I'm fatigued, not after a fixed number of swings.

**Why this priority**: Directly affects dealer well-being and retention. Also a legal/compliance concern.

**Independent Test**: Can be verified by checking that a dealer with 120+ min worked receives a break assignment (not another swing), confirmed via `swing_metrics.fatigue_triggered_break`.

**Acceptance Scenarios**:

1. **Given** a dealer has worked 90+ minutes continuously, **When** `process-swing` runs, **Then** `evaluateBreakNeed` returns break-needed and dealer is assigned to break instead of another table
2. **Given** a dealer has worked 30 minutes, **When** `process-swing` runs, **Then** swing duration is normal (not reduced by fatigue penalty)

---

### User Story 3 - Club Admin Sees Duration Rationale (Priority: P2)

As a club admin, I want to understand why a specific swing duration was chosen so I can trust the automation and override if needed.

**Why this priority**: Trust and transparency are important for admin adoption, but not blocking.

**Independent Test**: Check `swing_metrics.duration_rationale` field for human-readable explanation of how duration was calculated.

**Acceptance Scenarios**:

1. **Given** a swing assignment has been created, **When** I inspect `swing_metrics`, **Then** I see a `duration_rationale` field explaining the calculation (e.g., "peak_hour:45min|fatigue:-5min|base:40min")

### Edge Cases

- What happens when there's no historical data (cold start < 3 days)? Use `suggest_swing_config` fallback (GREATEST(30, base_duration)).
- What happens when a dealer is both fatigued AND it's peak hour? Fatigue takes precedence — dealer is sent to break even during peak.
- What happens when swing duration calculation yields < 30 min? Floor at 30 min (DB constraint + edge floor).
- How does the system handle clubs with mixed table types (tournament + cash games)? Only tournament tables are considered for swing assignments.

## Requirements

### Functional Requirements

- **FR-001**: System MUST calculate swing duration dynamically per assignment based on club conditions, dealer fatigue, and historical patterns
- **FR-002**: System MUST floor swing duration at 30 minutes (DB constraint + application-level)
- **FR-003**: System MUST use `suggest_swing_config` for cold-start clubs (< 3 days of data): `GREATEST(30, base_duration)`
- **FR-004**: System MUST reduce swing duration by fatigue penalty (`-Math.floor(workedMin / 10) * 5`, max -60 at 120 min)
- **FR-005**: System MUST send fatigued dealers (evaluateBreakNeed returns true) to break instead of another swing
- **FR-006**: System MUST apply `returnTopN` via `pickTopDealers()` for candidate selection
- **FR-007**: System MUST log duration calculation rationale in `swing_metrics.duration_rationale`
- **FR-008**: System MUST use `dealer_shift_metrics` view (separate flat query) for historical data
- **FR-009**: System MUST apply intra-cycle exclusion across all 3 passes of `process-swing`
- **FR-010**: System MUST respect the no-release invariant — never release old dealer without confirmed replacement

### Key Entities

- **`swing_assignments`**: Stores each swing assignment with calculated duration, rationale, and timestamps
- **`swing_metrics`**: Tracks swing outcomes including duration, fatigue data, and rationale
- **`dealer_shift_metrics`** (VIEW): Aggregated historical shift data per dealer per club
- **`club_processing_locks`**: Distributed lock table for per-club swing processing

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of swing assignments have duration >= 30 minutes (enforced by DB + app logic)
- **SC-002**: Dealers with 120+ min worked are always assigned to break (not swing) — verified via metrics
- **SC-003**: Cold-start clubs (< 3 days) use fallback duration calculation — verified via metrics
- **SC-004**: Swing duration rationale is logged for 100% of assignments — verified via metrics table
- **SC-005**: No regressions in existing swing functionality — existing tests pass

## Assumptions

- Existing `suggest_swing_config` function is already correct and deployed
- `dealer_shift_metrics` view exists and returns correct data
- `pickTopDealers()` function exists and works correctly
- Club processing locks table is in place
- The 30-min minimum DB constraint is already deployed
- Only tournament tables are in scope for swing operations
