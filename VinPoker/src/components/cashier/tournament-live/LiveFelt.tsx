// Presentational poker felt for the Tournament Live tracker.
//
// PURE component (no data-fetching / realtime / polling — that stays in the
// parent; PR #12 safety machinery untouched). Shared by the public viewer, the
// operator tracker (TournamentLivePanel) and the replay path, so props stay
// backward-compatible and PokerCard(null) behaviour is never changed.
//
// Layout system (anti-overlap):
//  • A reserved CENTER SAFE-ZONE holds the V mark + board + pot in one stacked
//    group. No seat may enter it.
//  • Seats use a tuned 9-max position MAP per orientation — bottom seats sit low
//    on the rim, side seats stay outside the board zone — so nothing collides.
//  • The action ticker lives in a rail BELOW the felt, not on top of it.
//  • Seats are avatar + name + stack only (no name boxes); position badge is small.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { PokerCard, CardBack } from "./PokerVisuals";
import { ChipStack } from "./ChipStack";
import { FeltStatusBar } from "./FeltStatusBar";
import { useCountUp } from "@/hooks/useCountUp";
import type { PotBreakdown } from "@/lib/tracker-poker/potEngine";

/** Count-up text (Phase 3, tableFx only): tweens a numeric display toward its target.
 *  First render / enabled-off / reduced-motion emit the target directly, so static
 *  renders and the operator/TV paths stay byte-identical. Display only — never state. */
function CountUpText({ value, format, enabled }: { value: number; format: (n: number) => string; enabled: boolean }) {
  const v = useCountUp(value, { enabled });
  return <>{format(v)}</>;
}

export interface SeatInfo {
  player_id: string;
  display_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  table_id: string | null;
  position: string;
  avatar_url?: string | null;
  last_action?: string;
  is_folded?: boolean;
  is_all_in?: boolean;
  hole_cards?: string[];
  /** Chips committed on the CURRENT street (Live Action Engine overlay; 0/undef → no chip shown). */
  current_bet?: number;
  /** Net chips for the hand (ending − starting); set ONLY on a replay's final frame.
   * >0 → winner (gold glow + green "+X" badge under liveTableFx). null/undef → no badge. */
  net_won?: number | null;
  /** UAT wave 2 (compact viewer only): whole-hand chips committed by an ALL-IN seat —
   * keeps the ALL-IN pill's amount visible after the street sweeps current_bet to 0.
   * Absent → the pill falls back to current_bet (today's behavior). */
  total_committed?: number;
  /** liveBetChips (spectator): whole-hand committed chips for a NON-all-in seat, so the
   * committed-bet disc persists after the street sweeps current_bet to 0. Absent → the
   * disc falls back to current_bet (today's per-street behavior). */
  display_committed_bet?: number;
}

export interface ActionLog {
  street: string;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
}

export function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

// RPT-style flying-chip color by action (Option B). Returns a radial-gradient for the
// chip face, or `undefined` for unknown actions so the CSS default (gold) applies — do
// NOT return gold explicitly here, so operator/old paths with no kind stay byte-identical.
export function chipColorFor(kind?: string): string | undefined {
  switch (kind) {
    case "all_in":
      return "radial-gradient(circle at 35% 30%, #ff8a8a, #d33 55%, #7a1111 100%)"; // red
    case "call":
      return "radial-gradient(circle at 35% 30%, #9ff5c9, #2fbf73 55%, #0f6e3e 100%)"; // green
    case "post_sb":
    case "post_bb":
    case "post_ante":
      return "radial-gradient(circle at 35% 30%, #ffc97a, #d97a1e 55%, #7a3e0a 100%)"; // amber
    case "bet":
    case "raise":
      return "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)"; // gold
    default:
      return undefined; // CSS fallback (gold)
  }
}

export function formatActionLabel(a: ActionLog): string {
  const t = a.action_type;
  if (t === "fold") return "Fold";
  if (t === "check") return "Check";
  if (t === "call") return `Call ${formatStack(a.action_amount)}`;
  if (t === "bet") return `Bet ${formatStack(a.action_amount)}`;
  if (t === "raise") return `Raise ${formatStack(a.action_amount)}`;
  if (t === "all_in") return `All-In ${formatStack(a.action_amount)}`;
  if (t === "post_sb") return `SB ${formatStack(a.action_amount)}`;
  if (t === "post_bb") return `BB ${formatStack(a.action_amount)}`;
  if (t === "post_ante") return `Ante ${formatStack(a.action_amount)}`;
  return `${t} ${formatStack(a.action_amount)}`;
}

type Pt = { l: number; t: number };

// Tuned 9-max seat maps. Bottom seats (4–7) sit LOW on the rim; side seats (3,8)
// stay far out — so none of them overlap the centre safe-zone (board + pot).
// Portrait = a tall vertical RACETRACK (5/7 pill): seats line the long left/right
// straights + the rounded top/bottom ends.
const PORTRAIT_SEATS: Record<number, Pt> = {
  1: { l: 37, t: 90 },
  2: { l: 12, t: 74 },
  3: { l: 8, t: 48 },
  4: { l: 20, t: 20 },
  5: { l: 50, t: 10 },
  6: { l: 80, t: 20 },
  7: { l: 92, t: 48 },
  8: { l: 88, t: 74 },
  9: { l: 63, t: 90 },
};
// Landscape = a wide horizontal RACETRACK (13/6 pill) — same seat distribution as the
// operator racetrack, so the viewer reads like a real broadcast table (not an oval).
const LANDSCAPE_SEATS: Record<number, Pt> = {
  1: { l: 37, t: 86 },
  2: { l: 10, t: 62 },
  3: { l: 15, t: 27 },
  4: { l: 34, t: 12 },
  5: { l: 50, t: 9 },
  6: { l: 66, t: 12 },
  7: { l: 85, t: 27 },
  8: { l: 90, t: 62 },
  9: { l: 63, t: 86 },
};

// RACETRACK geometry — wide horizontal pill on desktop (13/6, like the operator
// racetrack) + a tall vertical pill on phones (5/7). The felt uses a stadium radius
// (9999px), and `maxW` caps it so on wide screens it stays a centred, well-
// proportioned table (mx-auto) with side margins instead of sprawling edge-to-edge.
const GEO = {
  portrait: { aspect: "5 / 7", seats: PORTRAIT_SEATS, centerTop: "44%", centerW: "60%", vSize: "clamp(26px,9vw,40px)", maxW: "440px" },
  landscape: { aspect: "13 / 6", seats: LANDSCAPE_SEATS, centerTop: "43%", centerW: "40%", vSize: "clamp(22px,4vw,36px)", maxW: "820px" },
};

// Viewer Felt V2 (viewerLayout-only) — CoinPoker-style geometry: sides pushed further
// out + top/bottom rows raised/lowered so the central column (board + pot) is wide open,
// and the felt is a touch larger. Used ONLY when viewerLayout is on; operator/TV keep GEO.
const PORTRAIT_SEATS_V2: Record<number, Pt> = {
  1: { l: 35, t: 92 }, 2: { l: 10, t: 76 }, 3: { l: 6, t: 50 }, 4: { l: 18, t: 18 }, 5: { l: 50, t: 8 },
  6: { l: 82, t: 18 }, 7: { l: 94, t: 50 }, 8: { l: 90, t: 76 }, 9: { l: 65, t: 92 },
};
const LANDSCAPE_SEATS_V2: Record<number, Pt> = {
  1: { l: 35, t: 88 }, 2: { l: 8, t: 60 }, 3: { l: 13, t: 24 }, 4: { l: 33, t: 9 }, 5: { l: 50, t: 6 },
  6: { l: 67, t: 9 }, 7: { l: 87, t: 24 }, 8: { l: 92, t: 60 }, 9: { l: 65, t: 88 },
};
// Phase-2 rim-tuned VIEWER landscape map (baseline-driven: at 880×406 the V2 top row
// t=6-9 floated pods 26-38px ABOVE the rim, and the bottom pair at l=35/65 sat 105px
// from the stadium's rounded-end centres — read as "seats in the middle of the table").
// V3: top row lowered ONTO the rim (t≈15.5-16 → overhang ≤8px with the Phase-2 scaled
// ~140px pods), bottom pair spread toward the rounded ends (l 35/65→29/71 → ≤63px) and
// raised off the status bar (t 88→82). Only `viewerLayout && !portrait` reads this;
// operator/TV keep LANDSCAPE_SEATS byte-identically.
const LANDSCAPE_SEATS_V3: Record<number, Pt> = {
  1: { l: 29, t: 82 }, 2: { l: 10, t: 62 }, 3: { l: 16, t: 22 }, 4: { l: 34, t: 16 }, 5: { l: 50, t: 15.5 },
  6: { l: 66, t: 16 }, 7: { l: 84, t: 22 }, 8: { l: 90, t: 62 }, 9: { l: 71, t: 82 },
};
const GEO_V2 = {
  portrait: { aspect: "5 / 7", seats: PORTRAIT_SEATS_V2, centerTop: "42%", centerW: "54%", vSize: "clamp(26px,9vw,40px)", maxW: "480px" },
  landscape: { aspect: "13 / 6", seats: LANDSCAPE_SEATS_V2, centerTop: "44%", centerW: "36%", vSize: "clamp(22px,4vw,36px)", maxW: "880px" },
};

// PR-A1 (liveFeltCompact): RPT-style COMPACT-WIDE stadium for PORTRAIT phones —
// felt ≈2.2:1 so felt+pods stay ≈30% of a 390px viewport instead of the tall 5/7
// racetrack. Pods straddle the rim (top/bottom rows sit half outside the oval, like a
// broadcast table). Used ONLY when viewerLayout && compact && portrait; every other
// path (operator/TV/replay-without-flag, landscape) keeps GEO/GEO_V2 byte-identical.
const PORTRAIT_SEATS_COMPACT: Record<number, Pt> = {
  1: { l: 36, t: 97 },
  2: { l: 12, t: 84 },
  3: { l: 8, t: 38 }, // side ends stay ≥8% — at 4% half the 58px pod fell off a 390px viewport
  4: { l: 22, t: 3 },
  5: { l: 50, t: 0 },
  6: { l: 78, t: 3 },
  7: { l: 92, t: 38 },
  8: { l: 88, t: 84 },
  9: { l: 64, t: 97 },
};
const GEO_COMPACT_PORTRAIT = {
  aspect: "2.2 / 1",
  seats: PORTRAIT_SEATS_COMPACT,
  centerTop: "50%",
  centerW: "44%",
  vSize: "clamp(26px,9vw,40px)", // unused in compact (V renders as a watermark instead)
  maxW: "480px",
};

export interface LiveFeltProps {
  /** Active seats already positioned for the table on view. */
  seats: SeatInfo[];
  /** The most recent actor — gets the gold spotlight ring. */
  lastActorId: string | null;
  /** The player whose turn it is to act next (Live Action Engine); null → no spotlight. */
  toActId?: string | null;
  /** Community cards padded to 5 slots ("" = empty → face-down V back). */
  displayCards: string[];
  potSize: number;
  potBreakdown: PotBreakdown | null;
  /** Multiple tables exist and none is resolved — show the picker hint instead. */
  multiTableUnresolved: boolean;
  handNumber: number | null;
  /** Latest action for the bottom rail (null = no actions yet). */
  latestAction: ActionLog | null;
  formatBB: (n: number) => string | null;
  /** Narrow-phone vertical layout (tall oval + portrait seat map). */
  portrait?: boolean;
  /** Seat number on the dealer button → renders a "D" puck. Omit/undefined → no puck (felt unchanged). */
  buttonSeat?: number | null;
  /**
   * Operator-console tap-to-select. ADDITIVE: when omitted the seat stays a plain
   * `<div>` (no role/tabIndex/handlers) so the public viewer + replay render is
   * byte-identical. When supplied, each seat becomes a keyboard-operable button
   * that reports its seat number.
   */
  onSeatClick?: (seatNumber: number) => void;
  /**
   * The seat the operator is currently entering an action for. ADDITIVE: null/
   * undefined → no frame (default render unchanged). A matching seat gets an
   * emerald OUTER frame — deliberately distinct from the engine to-act accent
   * ring (poker-accent on the avatar) so "whose turn" and "which seat I'm editing"
   * never read as the same highlight.
   */
  selectedSeat?: number | null;
  /**
   * P2-5 dead-button: the table's physical seat capacity (tournament_tables.max_seats).
   * ADDITIVE — when set, EMPTY physical seats render as dimmed placeholders (so a DEAD
   * button on an empty seat is visible, and the operator can tap one to set it via
   * onSeatClick). Omit/undefined → only occupied seats render (the public viewer +
   * replay + TV are byte-identical).
   */
  physicalSeats?: number;
  /**
   * Public spectator NEON variant (PokerVN / Stitch Dark). ADDITIVE: when true the
   * felt surface becomes dark blue-black with a neon-green (`--primary`) rim + glow
   * instead of the burgundy `--poker-felt` + gold rings. Omit/false → the burgundy
   * felt is byte-identical (operator racetrack / TV / replay unchanged). Set only by
   * the public viewer (and only under the liveHandFeed flag).
   */
  viewerNeon?: boolean;
  /**
   * liveTableFx (viewer-only): master switch for the table FX. ADDITIVE — when false
   * (operator/TV/replay always; viewer when the flag is off) the board key + reveal
   * behave EXACTLY as today (runtime byte-identical). When true the board card key is
   * value-stable (entrance fires once) + the flop staggers in.
   */
  tableFx?: boolean;
  /**
   * liveTableFx chip-push: a transient chip animates from this seat to the pot. Each
   * distinct `nonce` triggers one chip; null → no chips. Viewer-only. `kind` (the
   * originating action_type) colors the chip (all_in=red, call=green, blinds=amber,
   * bet/raise=gold); omitted/unknown → the CSS default gold (byte-identical).
   */
  chipPush?: { seatNumber: number; nonce: number; kind?: string } | null;
  /**
   * Viewer Felt V2 (liveViewerFeltV2): responsive, premium PUBLIC-VIEWER layout.
   * ADDITIVE — when false/absent (operator/TV/replay always; viewer when the flag is
   * off) the felt renders byte-identical to today. When true: every card sizes with the
   * FELT's own width (a CSS container query on the oval + `clamp()` inline styles) so
   * hole cards can't overlap each other / the board on mobile, and the felt forces its
   * OWN neon premium surface (independent of `viewerNeon`/`liveHandFeed`). Set only by
   * the public viewer (TournamentLiveView when `spectator && liveViewerFeltV2`).
   */
  viewerLayout?: boolean;
  /**
   * PR-A1 (liveFeltCompact): RPT-style compact PUBLIC-VIEWER layout. ADDITIVE — inert
   * unless `viewerLayout` is also on (operator/TV/replay-without-V2 stay byte-identical
   * even if this is passed). When active:
   *  • portrait felt becomes a 2.2:1 wide stadium (≈30% of a phone viewport incl. pods)
   *    with rim-straddling seat anchors; landscape geometry is unchanged;
   *  • seat nameplates show the stack BB-FIRST (chips demoted to the secondary line);
   *    when `formatBB` returns null the chips line renders alone — never a fake BB;
   *  • a persistent one-row status bar (blinds/ante · to-act · pot) renders directly
   *    under the oval (both orientations). Set only by the public viewer
   *    (TournamentLiveView when `spectator && liveFeltCompact`).
   */
  compact?: boolean;
  /**
   * Blind level for the status bar (compact only; ignored otherwise). null/absent or
   * bb<=0 → the blinds segment is hidden (never fabricated). Live passes the clock
   * level; replay passes the HAND's own detected blinds.
   */
  blinds?: { sb: number; bb: number; ante: number } | null;
  /**
   * UAT wave 2 (Fix 1 companion): the live hand is an all-in RUNOUT — betting is
   * closed, the board is being dealt out. The status bar's to-act segment shows
   * "Đang chạy board" instead of a (misleading) waiting-on-player name. Compact
   * viewer only; absent → no change.
   */
  runout?: boolean;
  /**
   * trackerShowdownRevealOrder (viewer) — ADDITIVE; absent → simultaneous reveal
   * (byte-identical). player_ids in the order they should table their cards at
   * showdown; each revealed seat's hole-card flip is delayed by its index ×
   * `revealStaggerMs`, so the cards appear in sequence ~0.5s apart.
   */
  revealOrder?: string[];
  /** Per-step delay for the staggered showdown reveal (ms). Default 500 when
   * `revealOrder` is set. */
  revealStaggerMs?: number;
}

export function LiveFelt({
  seats,
  lastActorId,
  toActId = null,
  displayCards,
  potSize,
  potBreakdown,
  multiTableUnresolved,
  handNumber,
  latestAction,
  formatBB,
  portrait = false,
  buttonSeat = null,
  onSeatClick,
  selectedSeat = null,
  physicalSeats,
  viewerNeon = false,
  tableFx = false,
  chipPush = null,
  viewerLayout = false,
  compact = false,
  blinds = null,
  runout = false,
  revealOrder,
  revealStaggerMs = 500,
}: LiveFeltProps) {
  const { t } = useTranslation();
  // V2 uses the wider CoinPoker geometry; operator/TV keep the current GEO (byte-identical).
  // PR-A1 compact is DOUBLE-gated on viewerLayout so it can never touch operator/TV even
  // if the prop leaks; geometry only changes in portrait (landscape 13/6 is already wide).
  const compactActive = viewerLayout && compact;
  const geoSet = viewerLayout ? GEO_V2 : GEO;
  const geo = compactActive && portrait ? GEO_COMPACT_PORTRAIT : portrait ? geoSet.portrait : geoSet.landscape;
  // Phase 2: the VIEWER landscape reads the rim-tuned V3 map; every other path keeps its
  // geo map. All seat/stack/chip-fly placements read `seatMap` so the three stay in sync
  // (module constants → stable identity for the chips-effect dependency).
  const seatMap = viewerLayout && !portrait ? LANDSCAPE_SEATS_V3 : geo.seats;
  const boardCardCls = "h-[44px] w-[32px] sm:h-[52px] sm:w-[38px]";
  // Phase 3 (tableFx only): the POT display counts up toward its target instead of
  // jumping (~260ms ease-out). tableFx off / reduced-motion → displayPot === potSize
  // on every render, so operator/TV and static renders are byte-identical. Display
  // only — every gate below still reads the raw potSize.
  const displayPot = useCountUp(potSize, { enabled: tableFx });

  // trackerShowdownRevealOrder: this seat's flip delay = its place in the reveal
  // order × the per-step stagger. Not in `revealOrder` (or prop absent) → undefined
  // → no delay (simultaneous, byte-identical). Index 0 → 0ms (starts immediately).
  const revealDelayStyle = (playerId: string): CSSProperties | undefined => {
    if (!revealOrder) return undefined;
    const i = revealOrder.indexOf(playerId);
    return i > 0 ? { animationDelay: `${i * revealStaggerMs}ms` } : undefined;
  };

  // Viewer Felt V2 — cards size with the FELT's own width (cqi resolves to the
  // container-type set on the oval below) so they never overlap on mobile. Inline
  // width/height beats the fixed Tailwind size class. When viewerLayout is off these
  // are `undefined` → every card keeps its current size (operator/TV byte-identical).
  const holeStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(15px,6.2cqi,26px)", height: "clamp(21px,8.7cqi,36px)" }
      : { width: "clamp(16px,3.0cqi,30px)", height: "clamp(22px,4.2cqi,42px)" }
    : undefined;
  const boardStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(22px,8.4cqi,40px)", height: "clamp(31px,11.8cqi,56px)" }
      : { width: "clamp(26px,4.6cqi,48px)", height: "clamp(36px,6.4cqi,66px)" }
    : undefined;
  // Committed-bet chip STACK on the felt (viewerLayout only): disc + label sizing,
  // scaling with the felt via cqi (and uniformly under the narrow-landscape `fit`).
  const stackStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(12px,4.6cqi,20px)", fontSize: "clamp(7px,2.6cqi,10px)" }
      : { width: "clamp(11px,2.3cqi,18px)", fontSize: "clamp(7px,1.6cqi,10px)" }
    : undefined;
  // Phase 2 (viewerLayout only): the PODS scale with the felt exactly like the cards do.
  // Baseline: fixed 58/70px pods read 7.95% of an 880px felt (N8 broadcast ≈ 12-15%) —
  // players looked lost on the table. 11cqi ≈ 97px at 880 (11%); floors keep the 560px
  // `fit` design width + portrait phones at today's sizes (no regress); caps bound it.
  // When viewerLayout is off all of these are `undefined` → operator/TV byte-identical.
  const podStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(56px,15cqi,84px)" }
      : { width: "clamp(58px,11cqi,112px)" }
    : undefined;
  const avatarStyle: CSSProperties | undefined = viewerLayout
    ? portrait
      ? { width: "clamp(32px,8.5cqi,44px)", height: "clamp(32px,8.5cqi,44px)" }
      : { width: "clamp(34px,5.4cqi,52px)", height: "clamp(34px,5.4cqi,52px)" }
    : undefined;
  const nameTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(10px,1.5cqi,14px)" } : undefined;
  const bbTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(11px,1.6cqi,15px)" } : undefined;
  const subTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(8px,1.2cqi,11px)" } : undefined;
  const badgeTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(7px,0.95cqi,9.5px)" } : undefined;
  const toActTextStyle: CSSProperties | undefined = viewerLayout ? { fontSize: "clamp(7.5px,1cqi,10px)" } : undefined;
  // Where a seat's chip stack sits: lerp from the seat toward the pot center, then
  // COLLISION-GUARDED — clamp the result to a minimum radial gap from the pot center so
  // near-pot/top seats can't land on the board safe-zone and 9 stacks don't converge onto
  // each other at the pot (the board is positionally protected, NOT just by z-order).
  // K + MINGAP are tuned in the 9-handed-all-bet visual check.
  const potCenterT = parseFloat(geo.centerTop) || 43;
  // UAT wave 2 (Fix 2, compact only): chips sit NEAR THE SEAT (RPT pattern, lerp 30%)
  // instead of 42%-plus-center-ring — 9-max all-in stacks no longer converge mid-felt,
  // so the radial center-gap clamp is unnecessary by construction (seat-anchored
  // stacks can't reach the pot; nearest compact seat t=0 lands at t=15% vs board top
  // ≈34%). 0.30 (not lower) because the pills now carry amounts and need clearance
  // from the pod block — tuned on the 9-max all-in worst case. Non-compact keeps
  // K=0.42 + the clamp — flag-off render byte-identical.
  const STACK_K = compactActive ? 0.3 : 0.42;
  const STACK_MINGAP = 16; // % of the felt that the stack center stays clear of the pot
  const stackPt = (pos: Pt): Pt => {
    let l = pos.l + (50 - pos.l) * STACK_K;
    let t = pos.t + (potCenterT - pos.t) * STACK_K;
    if (compactActive) return { l, t };
    const dx = l - 50;
    const dy = t - potCenterT;
    const d = Math.hypot(dx, dy);
    if (d > 0.01 && d < STACK_MINGAP) {
      l = 50 + (dx / d) * STACK_MINGAP;
      t = potCenterT + (dy / d) * STACK_MINGAP;
    }
    return { l, t };
  };
  // V2 forces its OWN neon premium surface, so the redesign never depends on the
  // separate liveHandFeed/viewerNeon flag being on (review P1).
  const neon = viewerNeon || viewerLayout;
  // RPT-style subtle hole-card FAN (viewer only): the two cards tilt out + overlap a hair.
  const fanFor = (ci: number): CSSProperties | undefined =>
    !viewerLayout
      ? undefined
      : ci === 0
        ? { transform: "rotate(-7deg)", transformOrigin: "bottom right", marginRight: "-3px" }
        : { transform: "rotate(7deg)", transformOrigin: "bottom left", marginLeft: "-3px" };

  // liveTableFx chip-push: a transient chip per distinct nonce flies seat→pot.
  // Reduced-motion → never enqueue (so the absent onAnimationEnd can't orphan a chip).
  const [chips, setChips] = useState<{ id: number; fx: string; fy: string; color?: string }[]>([]);
  const lastChipNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!chipPush || lastChipNonce.current === chipPush.nonce) return;
    lastChipNonce.current = chipPush.nonce;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const slot = ((chipPush.seatNumber - 1) % 9) + 1;
    const pos = seatMap[slot] || seatMap[1];
    // Phase 3: cap the transient queue at 3 — at 8× replay (125ms/step vs the ~520ms fly
    // animation) unbounded pushes stack into chip spam; the newest 3 keep the effect legible.
    setChips((cs) => [...cs, { id: chipPush.nonce, fx: `${pos.l}%`, fy: `${pos.t}%`, color: chipColorFor(chipPush.kind) }].slice(-3));
  }, [chipPush, seatMap]);

  // V2 landscape scale-to-fit: a wide 9-max table can't fit a narrow phone width without
  // overlap, so below LANDSCAPE_DESIGN_W we render the felt at that design width and scale
  // the WHOLE thing down to fit (everything shrinks uniformly → never overlaps). Portrait is
  // untouched (it already fits, and stays the big-readable option). Wide screens (≥ design
  // width) also untouched. Operator/TV (viewerLayout off) never measure.
  const LANDSCAPE_DESIGN_W = 560;
  const FIT_PAD = 26; // breathing room above/below for pods that straddle the rim
  const feltWrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; h: number } | null>(null);
  useEffect(() => {
    if (!viewerLayout || portrait) { setFit(null); return; }
    const el = feltWrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (!w || w >= LANDSCAPE_DESIGN_W) { setFit(null); return; }
      const scale = w / LANDSCAPE_DESIGN_W;
      const designH = (LANDSCAPE_DESIGN_W * 6) / 13; // landscape aspect 13/6
      setFit({ scale, h: Math.round(designH * scale) + FIT_PAD * 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewerLayout, portrait]);

  return (
    <div className="w-full" ref={feltWrapRef}>
      {/* Felt oval — scales with container; seats may straddle the rim so the
          container is overflow-visible (never clips a seat). When `fit` is set
          (narrow landscape) a height-reserver clips the oversized design-width box
          and the oval is scaled down to fit, so a wide 9-max table never overlaps. */}
      {/* When fit: a real height-reserver box clips the oversized design-width felt.
          When NOT fit: display:contents → this wrapper vanishes, so operator/TV/portrait
          render the oval exactly as before (byte-identical). */}
      <div
        style={
          fit
            ? { position: "relative", height: fit.h, overflow: "hidden" }
            : compactActive && portrait
              ? // Compact stadium: rim-straddling pods extend ~44px above/below the short
                // oval — reserve that space so nothing above (headers) or below (status
                // bar) ever overlaps a pod. Non-compact keeps display:contents (identical).
                { paddingTop: 44, paddingBottom: 44 }
              : { display: "contents" }
        }
      >
      <div
        className={fit ? "overflow-visible" : "relative mx-auto w-full overflow-visible"}
        style={
          fit
            ? {
                // Fit (narrow landscape): render at the design width, CENTER it (absolute +
                // left 50% + translateX(-50%) — margin-auto can't center an element wider
                // than its container), then scale the whole thing down to fit.
                aspectRatio: geo.aspect,
                position: "absolute",
                left: "50%",
                top: `${FIT_PAD}px`,
                width: `${LANDSCAPE_DESIGN_W}px`,
                transform: `translateX(-50%) scale(${fit.scale})`,
                transformOrigin: "top center",
                containerType: "inline-size",
              }
            : {
                // Default (byte-identical with pre-V2): the oval scales with its container.
                aspectRatio: geo.aspect,
                maxWidth: geo.maxW,
                // V2: make the oval a size container so card `cqi` units resolve to the FELT
                // width. inline-size containment only fixes the inline axis — height still
                // comes from aspectRatio + width, so there is no sizing side-effect.
                ...(viewerLayout ? { containerType: "inline-size" } : {}),
              }
        }
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            borderRadius: "9999px",
            // viewerLayout (V2) → RPT-style CLEAN CHARCOAL felt + a thin neon-green rim hint
            // (keeps the VinPoker brand without a heavy green felt). `neon` (old viewerNeon-only
            // path) keeps the green felt; default = burgundy operator felt.
            background: viewerLayout
              ? "radial-gradient(circle at 50% 42%, #282a2f 0%, #1c1e22 44%, #101114 100%)"
              : neon
              ? "radial-gradient(62% 60% at 50% 38%, hsl(158 30% 13%) 0%, hsl(158 30% 13%) 50%, hsl(210 13% 5%) 100%)"
              : "radial-gradient(62% 60% at 50% 38%, hsl(var(--poker-felt)) 0%, hsl(var(--poker-felt)) 50%, hsl(var(--poker-felt-dark)) 100%)",
            boxShadow: viewerLayout
              ? "inset 0 0 0 1.5px hsl(var(--primary) / 0.22), inset 0 22px 60px rgba(0,0,0,0.42), inset 0 0 64px rgba(0,0,0,0.5), 0 18px 48px rgba(0,0,0,0.5), 0 0 28px hsl(var(--primary) / 0.06)"
              : neon
              ? "inset 0 0 0 5px hsl(var(--primary) / 0.4), inset 0 0 0 7px hsl(210 13% 5% / 0.85), inset 0 0 0 8px hsl(var(--primary) / 0.55), inset 0 0 70px rgba(0,0,0,0.55), 0 22px 55px rgba(0,0,0,0.45), 0 0 36px hsl(var(--primary) / 0.12)"
              : "inset 0 0 0 5px hsl(var(--poker-gold) / 0.5), inset 0 0 0 7px hsl(var(--poker-felt-dark) / 0.85), inset 0 0 0 8px hsl(var(--poker-gold) / 0.7), inset 0 0 70px rgba(0,0,0,0.5), 0 22px 55px rgba(0,0,0,0.42)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            borderRadius: "9999px",
            background: "radial-gradient(52% 42% at 50% 20%, rgba(255,255,255,0.06), transparent 72%)",
          }}
        />

        {/* CENTER SAFE-ZONE — V mark + board + pot, one stacked group. Seats stay
            out of this area. pointer-events-none so it never blocks the felt. */}
        <div
          className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ top: geo.centerTop, width: geo.centerW, maxWidth: "244px" }}
        >
          {compactActive && portrait ? (
            // Compact stadium: no vertical room to STACK the V above the board — it
            // becomes a faint centered watermark BEHIND the board instead (RPT puts its
            // brand the same way), so the short felt fits board + pot without clipping.
            <div
              data-testid="felt-v"
              aria-hidden="true"
              className="tracker-display absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 font-black leading-none"
              style={{ fontSize: "clamp(44px,20cqi,72px)", color: "hsl(var(--primary) / 0.10)" }}
            >
              V
            </div>
          ) : (
          <div
            data-testid="felt-v"
            className="tracker-display mb-2 font-black leading-none"
            style={{ fontSize: geo.vSize, color: neon ? "hsl(var(--primary) / 0.5)" : "hsl(var(--poker-gold) / 0.55)", textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
          >
            V
          </div>
          )}
          {/* Board — revealed cards face up; unrevealed slots = premium V-logo backs. */}
          <div data-testid="board-cards" className="flex items-center justify-center gap-1.5">
            {displayCards.map((card, i) =>
              card ? (
                <PokerCard
                  // tableFx → value-stable key (entrance fires once); else the current key
                  // (runtime byte-identical for operator/TV/replay). Keys aren't in the DOM.
                  key={tableFx ? card : `${i}-${card}`}
                  card={card}
                  size="md"
                  className={boardCardCls}
                  // V2 boardStyle (clamp) merges with the FX stagger delay; both absent → undefined.
                  style={
                    boardStyle || (tableFx && i < 3)
                      ? { ...boardStyle, ...(tableFx && i < 3 ? { animationDelay: `${i * 45}ms` } : {}) }
                      : undefined
                  }
                />
              ) : (
                <CardBack key={`${i}-back`} size="md" className={boardCardCls} style={boardStyle} />
              )
            )}
          </div>
          {/* Compact portrait: the pot lives in the STATUS BAR below (RPT pattern) — the
              short felt keeps only the board centered, so 9-max pods never collide. */}
          {potSize > 0 && !(compactActive && portrait) && (
            <div className="mt-2.5 flex flex-col items-center">
              <div
                className="tracker-pot-pulse inline-flex flex-col items-center rounded-full bg-black/55 px-3.5 py-1"
                style={{ border: "1px solid hsl(var(--poker-gold) / 0.42)" }}
              >
                <div className={`tracker-display text-[8px] uppercase tracking-[0.22em]${viewerLayout ? " inline-flex items-center gap-1" : ""}`} style={{ color: "hsl(var(--poker-gold) / 0.78)" }}>
                  {viewerLayout && (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: "radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%)", boxShadow: "0 0 0 1px rgba(0,0,0,.4)" }}
                    />
                  )}
                  {t("liveHub.felt.pot", "Pot")}
                </div>
                <div className="tracker-num text-lg font-bold leading-tight sm:text-xl" style={{ color: "hsl(var(--poker-gold))" }}>
                  {formatStack(displayPot)}
                  {formatBB(potSize) && (
                    <span className="ml-1.5 text-[10px] font-normal" style={{ color: "hsl(var(--poker-gold) / 0.6)" }}>
                      ({formatBB(displayPot)})
                    </span>
                  )}
                </div>
              </div>
              {potBreakdown && potBreakdown.sidePots.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  {potBreakdown.pots.map((pot, i) => (
                    <span
                      key={i}
                      className={`tracker-num rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold border ${
                        i === 0
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-[hsl(var(--poker-gold)/0.4)] text-[hsl(var(--poker-gold))]"
                      }`}
                    >
                      {i === 0 ? t("liveHub.felt.main", "Main") : t("liveHub.felt.side", "Side {{i}}", { i })} {formatStack(pot.amount)}
                      <span className="ml-1 font-normal opacity-60">({pot.eligible_player_ids.length})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {seats.map((seat) => {
          const slot = ((seat.seat_number - 1) % 9) + 1;
          const pos = seatMap[slot] || seatMap[1];
          const posStyle: CSSProperties = { left: `${pos.l}%`, top: `${pos.t}%`, transform: "translate(-50%, -50%)" };

          const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
          const isToAct = !seat.is_folded && !seat.is_all_in && toActId === seat.player_id;
          const initials = seat.display_name.slice(0, 2).toUpperCase();
          // Dealer "D" puck: exact seat when buttonSeat is supplied, else fall
          // back to the BTN position label so the puck shows on every felt path.
          const isButtonSeat =
            buttonSeat != null
              ? seat.seat_number === buttonSeat
              : seat.position === "BTN" || seat.position === "BTN/SB";

          const avatarBorder = seat.is_folded
            ? "border-border/30"
            : seat.is_all_in
              ? "border-red-400/70"
              : isToAct
                ? "border-[hsl(var(--poker-accent))]"
                : isLastActor
                  ? "border-[hsl(var(--poker-gold)/0.85)]"
                  : "border-[hsl(var(--poker-gold)/0.5)]";
          const avatarRing = isToAct
            ? "ring-2 ring-[hsl(var(--poker-accent)/0.55)]"
            : isLastActor
              ? "ring-1 ring-[hsl(var(--poker-gold)/0.4)]"
              : "";
          const nameShadow = { textShadow: "0 1px 3px rgba(0,0,0,0.95)" };
          // Showdown winner (replay final frame, viewer FX only): gold glow + green
          // net-won badge. net_won is set only on the replay final frame, so live /
          // operator / TV never trigger this — byte-identical without `tableFx`.
          const netWon = seat.net_won ?? 0;
          const isWinner = tableFx && netWon > 0;

          // ADDITIVE operator-console hooks. Both fragments are "" and the spread
          // is {} when the props are absent, so the default (viewer/replay) render
          // is byte-identical. The selection frame sits on the OUTER wrapper and
          // is emerald — distinct from the to-act accent ring on the avatar.
          const isSelected = selectedSeat != null && seat.seat_number === selectedSeat;
          const interactiveCls = onSeatClick ? " cursor-pointer" : "";
          const selectedCls = isSelected
            ? " rounded-2xl ring-2 ring-emerald-400 ring-offset-2 ring-offset-[hsl(var(--poker-felt-dark))] shadow-[0_0_16px_rgba(16,185,129,0.55)]"
            : "";
          const interactiveProps = onSeatClick
            ? {
                role: "button" as const,
                tabIndex: 0,
                "aria-pressed": isSelected,
                onClick: () => onSeatClick(seat.seat_number),
                onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeatClick(seat.seat_number);
                  }
                },
              }
            : {};

          return (
            <div
              key={seat.player_id}
              className={`absolute z-10 ${seat.is_folded ? "opacity-50" : ""}${tableFx ? " transition-opacity duration-300 motion-reduce:transition-none" : ""}${interactiveCls}${selectedCls}`}
              style={posStyle}
              {...interactiveProps}
            >
              <div className="relative flex w-[58px] flex-col items-center text-center sm:w-[70px]" style={podStyle}>
                {isToAct && (
                  <div
                    className="tracker-display absolute -top-2 z-20 rounded-full px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-wide whitespace-nowrap text-white shadow"
                    style={{ background: "hsl(var(--poker-accent))", ...toActTextStyle }}
                  >
                    ◀ {t("liveHub.felt.toAct", "chờ")}
                  </div>
                )}
                <div className="relative">
                  <div
                    className={`grid ${viewerLayout ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8 sm:h-9 sm:w-9"} place-items-center overflow-hidden rounded-full border-2 text-[9px] font-bold sm:text-[11px] ${
                      isWinner ? "tracker-win-glow border-[hsl(var(--poker-gold))]" : `${avatarBorder} ${avatarRing}`
                    }${tableFx ? " transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none" : ""}`}
                    style={{ background: "linear-gradient(180deg,#2c151b,#0b090d)", color: "hsl(var(--poker-gold))", ...avatarStyle }}
                  >
                    {seat.avatar_url ? (
                      <img src={seat.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  {seat.position && (
                    <span
                      className={`tracker-display absolute -top-1 -right-2 rounded-full px-1 py-px text-[7px] font-semibold uppercase leading-none ${
                        seat.position === "BTN" ? "text-black" : "text-amber-200/85"
                      }`}
                      style={
                        seat.position === "BTN"
                          ? { background: "hsl(var(--poker-gold))", ...badgeTextStyle }
                          : { background: "rgba(18,11,7,0.85)", border: "1px solid hsl(var(--poker-gold) / 0.4)", ...badgeTextStyle }
                      }
                    >
                      {seat.position}
                    </span>
                  )}
                  {isButtonSeat && (
                    <span
                      aria-label="Dealer"
                      className="tracker-display absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full text-[7px] font-black leading-none text-black shadow ring-1 ring-black/40"
                      style={{ background: "hsl(var(--poker-gold))" }}
                    >
                      D
                    </span>
                  )}
                </div>
                {viewerLayout ? (
                  // V2: a CoinPoker-style "nameplate" capsule — name + stack grouped in one
                  // dark, neon-bordered pill so each seat reads as a tight unit.
                  // PR-A1 compact: the stack goes BB-FIRST (RPT pattern — meaningful at any
                  // level) with chips demoted to a smaller secondary line. formatBB null
                  // (no blind level) → chips render alone exactly as today: never a fake BB.
                  <div
                    className="mt-1 flex max-w-full flex-col items-center rounded-md px-1.5 py-[3px] leading-none"
                    style={{ background: "rgba(8,12,10,0.82)", border: "1px solid hsl(var(--primary) / 0.28)", boxShadow: "0 1px 3px rgba(0,0,0,0.55)" }}
                  >
                    <div className="tracker-display max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]" style={nameTextStyle}>
                      {seat.display_name}
                    </div>
                    {compactActive && formatBB(seat.chip_count) ? (
                      <>
                        <div className="tracker-num mt-[1px] whitespace-nowrap text-[11px] font-bold leading-none" style={{ color: "hsl(146 62% 56%)", ...bbTextStyle }}>
                          <CountUpText value={seat.chip_count} format={(n) => formatBB(n) ?? formatStack(n)} enabled={tableFx} />
                        </div>
                        <div className="tracker-num mt-[1px] whitespace-nowrap text-[8px] font-semibold leading-none text-white/60" style={subTextStyle}>
                          <CountUpText value={seat.chip_count} format={formatStack} enabled={tableFx} />
                        </div>
                      </>
                    ) : (
                      <div className="tracker-num mt-[1px] text-[10px] font-bold leading-none" style={{ color: "hsl(146 62% 56%)", ...bbTextStyle }}>
                        <CountUpText value={seat.chip_count} format={formatStack} enabled={tableFx} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="tracker-display mt-1 max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]" style={nameShadow}>
                      {seat.display_name}
                    </div>
                    <div className="tracker-num text-[10px] font-bold leading-tight" style={{ color: "hsl(var(--poker-stack))", textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
                      {formatStack(seat.chip_count)}
                    </div>
                  </>
                )}
                {isWinner && (
                  <div
                    data-testid="seat-net-won"
                    className="tracker-win-amount tracker-num mt-0.5 text-[9px] font-extrabold leading-tight sm:text-[10px]"
                    style={{ color: "hsl(var(--success))", textShadow: "0 1px 3px rgba(0,0,0,0.95)" }}
                  >
                    +{formatStack(netWon)}
                    {formatBB(netWon) ? <span className="font-bold opacity-80"> ({formatBB(netWon)})</span> : null}
                  </div>
                )}
                {/* Committed-bet indicator. viewerLayout → an RPT-style chip STACK rendered
                    ON THE FELT (in the placement layer below the seats map), NOT a pill here.
                    Operator/TV (viewerLayout off) keep the standalone ALL IN label as today,
                    so their render is byte-identical even with current_bet now populated. */}
                {!viewerLayout && seat.is_all_in && (
                  <div className="mt-0.5 text-[8px] font-bold text-red-400" style={nameShadow}>{t("liveHub.felt.allIn", "ALL IN")}</div>
                )}
                {seat.is_folded && <div className="mt-0.5 text-[8px] text-zinc-300" style={nameShadow}>{t("liveHub.felt.folded", "FOLDED")}</div>}
                {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                  <div className="mt-0.5 max-w-full truncate text-[8px] text-amber-300/90" style={nameShadow}>{seat.last_action}</div>
                )}
                {/* Compact: face-DOWN backs are dropped entirely (RPT pods carry no cards
                    until a reveal) — the short felt can't afford the extra pod height.
                    Revealed cards (showdown/all-in) still render. Non-compact unchanged. */}
                {(!compactActive || (seat.hole_cards && seat.hole_cards.length === 2)) && (
                <div
                  data-testid="seat-holecards"
                  className={`mt-0.5 flex justify-center gap-0.5${isWinner ? " tracker-win-glow rounded-md p-0.5" : ""}`}
                >
                  {seat.hole_cards && seat.hole_cards.length === 2 ? (
                    // trackerShowdownRevealOrder: stagger the flip by this seat's place
                    // in the reveal order (index * revealStaggerMs added to the existing
                    // tracker-card-reveal pop). revealOrder absent → delay undefined →
                    // today's simultaneous reveal (byte-identical). Reduced-motion kills
                    // the animation entirely (CSS), so the delay is moot for a11y.
                    seat.hole_cards.map((card, ci) => (
                      <PokerCard
                        key={ci}
                        card={card}
                        size="xs"
                        muted={seat.is_folded}
                        style={{ ...holeStyle, ...fanFor(ci), ...revealDelayStyle(seat.player_id) }}
                      />
                    ))
                  ) : (
                    [0, 1].map((ci) => <CardBack key={ci} size="xs" muted={seat.is_folded} style={{ ...holeStyle, ...fanFor(ci) }} />)
                  )}
                </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Committed-bet CHIP STACKS on the felt (viewerLayout only). A pointer-events-none
            layer placed in front of each betting/all-in seat, toward the pot (collision-guarded
            stackPt). Operator/TV never render this → byte-identical. z-[15]: above the felt,
            below the to-act badge (z-20) and the flying chip-push (z-[25]). */}
        {viewerLayout &&
          seats
            .filter((s) => s.is_all_in || (!s.is_folded && ((s.current_bet ?? 0) > 0 || (s.display_committed_bet ?? 0) > 0)))
            .map((s) => {
              const slot = ((s.seat_number - 1) % 9) + 1;
              const pt = stackPt(seatMap[slot] || seatMap[1]);
              // liveBetChips: prefer the whole-hand committed (display_committed_bet) so the
              // disc persists across street sweeps; fall back to the per-street current_bet
              // (today's behavior when the field is absent → byte-identical).
              const amt = (s.display_committed_bet ?? 0) > 0 ? (s.display_committed_bet as number) : (s.current_bet ?? 0);
              // UAT wave 2 (Fix 3, compact only): the ALL-IN pill prefers the seat's
              // WHOLE-HAND committed total (survives street sweeps), and — RPT style —
              // shows the AMOUNT ALONE on the red pill: the red stack already signals
              // all-in, and the wide "ALL IN 29.9M" labels collided on 9-max bottom
              // rows at 390px. Non-compact keeps today's exact label logic.
              const allInAmt = compactActive ? (s.total_committed ?? amt) : amt;
              const label = s.is_all_in
                ? allInAmt > 0
                  ? compactActive
                    ? formatStack(allInAmt)
                    : `${t("liveHub.felt.allIn", "ALL IN")} ${formatStack(allInAmt)}`
                  : t("liveHub.felt.allIn", "ALL IN")
                : formatStack(amt);
              return (
                <div
                  key={`stack-${s.player_id}-${s.is_all_in ? "allin" : amt}`}
                  className="pointer-events-none absolute z-[15] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pt.l}%`, top: `${pt.t}%` }}
                >
                  <ChipStack label={label} allIn={s.is_all_in} sizeStyle={stackStyle} />
                </div>
              );
            })}

        {/* P2-5 ADDITIVE: empty physical seats (only when physicalSeats is supplied —
            absent for the public viewer/replay/TV, so their render is byte-identical).
            A dead button shows its "D" puck here; an operator tap sets the button. */}
        {physicalSeats != null &&
          Array.from({ length: physicalSeats }, (_, i) => i + 1)
            .filter((n) => !seats.some((s) => s.seat_number === n))
            .map((n) => {
              const slot = ((n - 1) % 9) + 1;
              const pos = seatMap[slot] || seatMap[1];
              const posStyle: CSSProperties = { left: `${pos.l}%`, top: `${pos.t}%`, transform: "translate(-50%, -50%)" };
              const isButtonSeat = buttonSeat != null && buttonSeat === n;
              const tap = onSeatClick;
              return (
                <div
                  key={`empty-${n}`}
                  className={`absolute z-10 flex flex-col items-center opacity-60${tap ? " cursor-pointer" : ""}`}
                  style={posStyle}
                  {...(tap
                    ? {
                        role: "button" as const,
                        tabIndex: 0,
                        onClick: () => tap(n),
                        onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            tap(n);
                          }
                        },
                      }
                    : {})}
                >
                  <div className="relative grid h-9 w-9 place-items-center rounded-full border border-dashed border-white/25 bg-black/20 text-[9px] font-bold text-white/45 sm:h-10 sm:w-10">
                    {n}
                    {isButtonSeat && (
                      <span
                        aria-label="Dealer (dead button)"
                        className="tracker-display absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full text-[7px] font-black leading-none text-black shadow ring-1 ring-black/40"
                        style={{ background: "hsl(var(--poker-gold))" }}
                      >
                        D
                      </span>
                    )}
                  </div>
                  <div className="tracker-display mt-1 text-[9px] font-medium text-white/40">{t("liveHub.felt.emptySeat", "Trống")}</div>
                </div>
              );
            })}

        {/* liveTableFx chip-push layer — transient gold chips flying seat→pot. */}
        {chips.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-[25] overflow-visible" aria-hidden="true">
            {chips.map((c) => (
              <span
                key={c.id}
                className="tracker-chip-push"
                onAnimationEnd={() => setChips((cs) => cs.filter((x) => x.id !== c.id))}
                style={
                  {
                    "--cp-fx": c.fx,
                    "--cp-fy": c.fy,
                    "--cp-tx": "50%",
                    "--cp-ty": geo.centerTop,
                    // Action color (all_in=red, call=green, blinds=amber, bet/raise=gold).
                    // Omitted when undefined → the .tracker-chip-push CSS default (gold) fires.
                    ...(c.color ? { "--chip-color": c.color } : {}),
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        {multiTableUnresolved && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-lg bg-black/45 px-6 py-3 text-center text-sm text-zinc-200 backdrop-blur-sm">
              {t("liveHub.felt.multiTable", "Giải có nhiều bàn — chọn bàn ở trên để xem live.")}
            </div>
          </div>
        )}

        {!multiTableUnresolved && !handNumber && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-lg bg-black/45 px-6 py-3 text-sm text-zinc-200 backdrop-blur-sm">
              {t("liveHub.felt.waiting", "Chờ dealer bắt đầu hand...")}
            </div>
          </div>
        )}
      </div>
      </div>

      {/* PR-A1 compact: persistent status bar docked right under the oval (RPT pattern).
          compactActive-gated → operator/TV/replay-without-flag emit nothing new. */}
      {compactActive && (
        <FeltStatusBar
          blinds={blinds}
          toActName={
            toActId ? seats.find((s) => s.player_id === toActId)?.display_name ?? null : null
          }
          potSize={displayPot}
          formatBB={formatBB}
          runout={runout}
        />
      )}

      {/* Action rail — OUTSIDE the felt so it never collides with the table. */}
      {latestAction && (
        <div className="mt-2.5 px-2">
          <div className="tracker-display mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-500/30 bg-black/65 px-3.5 py-1.5 text-xs">
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-amber-400/80">{t("liveHub.felt.action", "Hành động")}</span>
            <span className="truncate text-amber-100">
              {latestAction.seat_number > 0 && <span className="text-amber-300/70">{t("liveHub.seat", "Ghế {{n}}", { n: latestAction.seat_number })} · </span>}
              <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
              <span className="tracker-num">{formatActionLabel(latestAction)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
