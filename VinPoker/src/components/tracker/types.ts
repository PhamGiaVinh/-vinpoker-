// PR-A — Tracker Racetrack Hand-Input UI: shared types (presentational only).
//
// ─── AMOUNT CONTRACT (consumed by PR-B — keep stable) ────────────────────────
//   ActionIntent.amount = the TOTAL chips this seat has committed on THIS street
//   AFTER the action (the "to" value), for: call / bet / raise / all_in.
//   It is 0 for fold / check.
//
//   Given  committed = chips already in this street, stack = chips behind,
//          toCall    = chips still needed to match the current bet:
//     fold / check : 0
//     call         : committed + toCall      (match up to the current street total)
//     bet (no bet) : the TOTAL typed in the pad
//     raise        : the TOTAL typed in the pad ("raise to", NOT the added amount)
//     all_in       : committed + stack       (everything that seat has this street)
//
//   The UI never decides pot / winner / stack / legality — it only emits this intent
//   upward. PR-B reads `amount` as the post-action street total for every betting action.
// ─────────────────────────────────────────────────────────────────────────────

export type TrackerAction = 'fold' | 'call' | 'check' | 'raise' | 'bet' | 'all_in';

export interface ActionIntent {
  seatNumber: number; // physical seat 1..9 (anchors layout — never array index)
  action: TrackerAction;
  amount: number; // see AMOUNT CONTRACT above
}

export interface SeatVM {
  seatNumber: number; // physical seat 1..9
  name: string;
  stack: number; // chips behind (NOT yet committed this street)
  position?: string; // display-only badge: UTG / BU / CO / SB / BB / ...
  committed?: number; // chips already committed this street
  isEmpty?: boolean;
  isFolded?: boolean;
  isAllIn?: boolean;
}

export interface TrackerRacetrackProps {
  seats: SeatVM[];
  actingSeatNumber: number | null;
  dealerSeatNumber?: number | null; // optional "D" button puck
  boardCards: string[]; // display strings, e.g. '5♦', 'K♠'
  pot: number;
  bigBlind: number;
  // Optional: tapping a seat selects the dealer button (pre-hand) or the actor
  // (during a hand). Display-only when absent — the PR-A preview is unaffected.
  onSeatTap?: (seatNumber: number) => void;
}

export interface ForcedAmountPadProps {
  stack: number; // acting seat's chips behind
  committedThisStreet: number; // acting seat's chips already in this street
  minTotal?: number; // SOFT min legal "raise to" hint (never hard-blocks)
  onConfirm: (total: number) => void; // returns the TOTAL ("raise to")
  onCancel: () => void;
}

export interface ActionDockProps {
  actingSeat: SeatVM | null;
  toCall: number; // chips the acting seat still needs to ADD to match
  bigBlind: number;
  onIntent: (intent: ActionIntent) => void;
  onUndo: () => void;
}
