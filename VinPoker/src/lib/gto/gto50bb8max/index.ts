// ============================================================
// GTO 50bb 8-max — Barrel module
// ------------------------------------------------------------
// Gom toàn bộ code liên quan tới chart GTO 50bb 8-max vào một
// entry point duy nhất để các nơi khác import gọn:
//
//   import {
//     OPEN_RANGE_50BB, GTO_POSITIONS, RAISE_SIZE,
//     makeSpotKey, getEffectiveRange, saveCustomRange,
//     GTOOpenRangeView, RangeEditor,
//   } from "@/lib/gto/gto50bb8max";
//
// File này KHÔNG chứa logic mới — chỉ re-export.
// Source of truth vẫn nằm ở các file gốc.
// ============================================================

// ---- Data nguồn (hard-coded chart 50bb 8-max) ----
export {
  OPEN_RANGE_50BB,
  GTO_POSITIONS,
  RAISE_SIZE,
  actionOf,
} from "../openRanges50bb";
export type { GTOAction, GTOPosition } from "../openRanges50bb";

// ---- Spot registry / load / save (DB + cache) ----
export {
  makeSpotKey,
  registerSpot,
  buildFullRange,
  exportRangeSnippet,
  hasPrecomputed,
  getAllRegisteredSpots,
  getPrecomputedRange,
  getEffectiveRange,
  getCustomRange,
  saveCustomRange,
  clearCustomRange,
  getUserRange,
  saveUserRange,
  clearUserRange,
  initRemoteRanges,
  initUserRanges,
  subscribeRangeUpdates,
  subscribeUserRangeUpdates,
} from "../precomputed";
export type { SpotKey } from "../precomputed";

// ---- Core types & helpers cho range tree ----
export {
  POSITIONS,
  ALL_POS,
  STACK_DEPTHS,
  STACK_BB,
  OPEN_SIZE,
  TOTAL_COMBOS,
  combosOf,
} from "../rangeTree";
export type {
  HandAction,
  Range,
  ActionStep,
  Position,
  TreePos,
  StackDepth,
} from "../rangeTree";
export { allHands, normalizeHandAction } from "../rangeTree";

// ---- Clipboard chia sẻ giữa GTO tab / Builder / Admin ----
export {
  copyRangeToClipboard,
  pasteRangeFromClipboard,
  subscribeClipboard,
} from "../rangeClipboard";
export type { ClipboardPayload } from "../rangeClipboard";

// ---- Hooks ----
export { useRangeTree } from "@/hooks/useRangeTree";
export { useRangeEditor } from "@/hooks/useRangeEditor";

// ---- UI components ----
export { default as GTOOpenRangeView } from "@/components/gto/GTOOpenRangeView";
export { default as RangeMatrix } from "@/components/gto/RangeMatrix";
export { default as RangeGrid } from "@/components/gto/RangeGrid";
export { default as TreeRangeGrid } from "@/components/gto/TreeRangeGrid";
export { default as ActionBar } from "@/components/gto/ActionBar";
export { default as StackDepthSelector } from "@/components/gto/StackDepthSelector";
export { default as RangeStats } from "@/components/gto/RangeStats";
export { default as RangeStatsBar } from "@/components/gto/RangeStatsBar";
export { default as RangeBreakdownPanel } from "@/components/gto/RangeBreakdownPanel";
export { default as HandEditor } from "@/components/gto/HandEditor";
export { default as RangeHistoryPanel } from "@/components/gto/RangeHistoryPanel";
export { default as RangeEditor } from "@/components/RangeEditor";

// ---- Convenience: build spot key cho 50bb 8-max nhanh ----
import { makeSpotKey as _makeSpotKey } from "../precomputed";
import type { Position } from "../rangeTree";

/** Tạo spotKey 50bb cho 1 vị trí + spot type (mặc định OPEN). */
export function spotKey50bb(position: Position, spotType: string = "OPEN"): string {
  return _makeSpotKey(position, spotType, 50);
}
