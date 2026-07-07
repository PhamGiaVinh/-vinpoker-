// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Mobile App — view types (dealer-facing portal over the Shift Planner V2.1
// layer). ADDITIVE only. These types never touch the live Dealer Swing system
// (dealer_attendance / dealer_assignments / dealer_rotation_schedule / swing_*) or
// payroll. Check-in is ROSTER attendance on dealer_shift_assignments only.
// ═══════════════════════════════════════════════════════════════════════════════

import type { ShiftStatus } from "@/types/shiftPlanner";

/** Where the dealer app reads its data. mock = in-memory demo (flag OFF / planner
 *  migration not applied); live = the dealer_shift_* tables (both flags ON). */
export type DealerDataSource = "mock" | "live";

/** A dealer's club-employment record projected for the app, enriched with the
 *  open-market identity bits from `profiles` (region / verification / avatar). */
export interface DealerProfileView {
  dealerId: string;
  userId: string | null;
  clubId: string;
  clubName: string;
  fullName: string;
  tier: string; // "A" | "B" | "C"
  status: string; // active | inactive | on_leave
  region?: string | null; // profiles.region — open market / international
  avatarUrl?: string | null;
  isVerified?: boolean;
  /** Auto-fill shift preference: som | muon | linh_hoat. null = flexible. */
  shiftPreference?: string | null;
}

/** One shift assignment row, dealer-facing. Mirrors dealer_shift_assignments plus
 *  optional display fields (game/table/venue) the planner may attach later. */
export interface DealerShiftView {
  id: string;
  dealerId: string;
  clubId: string;
  workDate: string; // YYYY-MM-DD (club-local)
  scheduledStartAt: string; // ISO timestamptz
  scheduledEndAt: string; // ISO timestamptz (may be next calendar day)
  role: string; // "Dealer" | "Lead" | "OnCall"
  status: ShiftStatus;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  gameType?: string | null;
  tableName?: string | null;
  venueName?: string | null;
  floorName?: string | null;
}

export type CheckInPhase = "not_confirmed" | "confirmed" | "checked_in" | "closed";

/** Pure, derived view-state for a shift's confirm/check-in/check-out lifecycle. */
export interface CheckInState {
  phase: CheckInPhase;
  canConfirm: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
  windowOpen: boolean;
  isLate: boolean;
  minutesUntilOpen: number; // 0 when the window is open
  windowOpensAt: string; // ISO
}

export type WeekCellKind = "shift" | "off" | "leave" | "on_call";

export interface WeekDayCell {
  date: string; // YYYY-MM-DD
  isToday: boolean;
  kind: WeekCellKind;
  shift: DealerShiftView | null;
  label: string; // "11:00 – 19:00" | "" (off)
  isNight: boolean;
  isOvernight: boolean;
}

export interface WeekSummaryView {
  weekStart: string; // YYYY-MM-DD (Monday)
  totalHours: number;
  targetHours: number;
  nightShifts: number;
  daysWorked: number;
}

// ── Careers / open dealer marketplace (additive; Inc 5–7) ──────────────────────

export type CareerProgramKind = "job" | "promotion" | "senior_upgrade" | "tournament" | "skill";
export type CareerApplicationStatus =
  | "applied"
  | "screening"
  | "interview"
  | "offered"
  | "hired"
  | "rejected";

export interface CareerProgramView {
  id: string;
  kind: CareerProgramKind;
  title: string;
  subtitle: string;
  region?: string | null;
  location?: string | null;
  gameTypes?: string[];
  payRange?: string | null;
  status: "open" | "closed" | "applied";
  description?: string;
  requirements?: string[];
}

export interface CareerApplicationView {
  id: string;
  programId: string;
  programTitle: string;
  kind: CareerProgramKind;
  status: CareerApplicationStatus;
  createdAt: string; // ISO
  note?: string | null;
}

export type CareerSessionKind = "interview" | "training";

export interface CareerSessionView {
  id: string;
  kind: CareerSessionKind;
  title: string;
  scheduledAt: string; // ISO
  mode: "online" | "onsite";
  location?: string | null; // venue label (onsite)
  joinUrl?: string | null; // meeting link (online)
  status: "scheduled" | "done" | "cancelled";
  programTitle?: string | null;
}

// ── Onboarding / account linking (open market) ─────────────────────────────────

/** How an auth user links to a dealer record. */
export type DealerLinkMethod = "phone" | "telegram";

/** A club dealer record in the staff "invite to app" directory (mock). */
export interface DealerDirectoryRow {
  id: string;
  fullName: string;
  phone: string;
  region?: string | null;
  status: string; // active | inactive | on_leave
  linked: boolean; // already linked to an auth user?
}
