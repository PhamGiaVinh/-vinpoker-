// ============================================================
// Pre-computed GTO Ranges — READ FROM GTO WIZARD PREMIUM
// MTT 50bb, 8-max, ChipEV
//
// Loveable contract:
//  - Format: TS module — file này được import sẵn ở app boot
//  - Spot key: `${position}_${spotType}_${depth}bb`
//      position: UTG | UTG1 | LJ | HJ | CO | BTN | SB | BB
//      spotType: OPEN | VS_3B | VS_4B | VS_ALLIN
//      depth:    số bb (vd 50)
//  - Range = Record<hand, HandAction>
//      HandAction = { fold, call, raise, allin } (sum = 1)
//  - Hand naming: "AA"…"22"  |  "AKs"…"32s"  |  "AKo"…"32o"
//  - buildFullRange() tự fill 169 hand fold=1; chỉ override hand non-fold.
//  - Range custom của admin lưu localStorage key `LOVEABLE_RANGE_<spotKey>`,
//    được merge ưu tiên hơn range hard-coded ở dưới khi đọc qua
//    getPrecomputedRange().
// ============================================================

import type { Range, HandAction, Position, StackDepth } from "./rangeTree";
import { normalizeHandAction, allHands } from "./rangeTree";
import { OPEN_RANGE_50BB, type GTOAction, type GTOPosition } from "./openRanges50bb";
import { supabase } from "@/integrations/supabase/client";

export type SpotKey = string;

const PRECOMPUTED = new Map<SpotKey, Range>();
// In-memory cache của range custom đã pull từ DB (do super admin save).
const REMOTE_CACHE = new Map<SpotKey, Range>();
// Per-user personal range cache (chỉ user hiện tại).
const USER_CACHE = new Map<SpotKey, Range>();
let _userCacheUid: string | null = null;
const subscribers = new Set<() => void>();
const userSubscribers = new Set<() => void>();

export function subscribeRangeUpdates(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
export function subscribeUserRangeUpdates(cb: () => void): () => void {
  userSubscribers.add(cb);
  return () => userSubscribers.delete(cb);
}
function notifyAll() { subscribers.forEach((cb) => { try { cb(); } catch {} }); }
function notifyUser() { userSubscribers.forEach((cb) => { try { cb(); } catch {} }); }

function normalizeRange(raw: unknown): Range {
  const out: Range = {};
  if (raw && typeof raw === "object") {
    for (const h of Object.keys(raw as any)) {
      const v = (raw as any)[h];
      if (v && typeof v === "object") out[h] = normalizeHandAction(v as HandAction);
    }
  }
  return out;
}

export function registerSpot(key: SpotKey, range: Range) {
  PRECOMPUTED.set(key, range);
}

/** Pull tất cả range custom từ DB + lắng nghe realtime. Gọi 1 lần khi app boot. */
let _initStarted = false;
export async function initRemoteRanges() {
  if (_initStarted) return;
  _initStarted = true;
  try {
    const { data, error } = await supabase
      .from("gto_spot_ranges")
      .select("spot_key, range");
    if (error) {
      console.warn("[GTO] initRemoteRanges error", error);
    } else if (data) {
      for (const row of data as Array<{ spot_key: string; range: any }>) {
        REMOTE_CACHE.set(row.spot_key, normalizeRange(row.range));
      }
      notifyAll();
    }
  } catch (err) {
    console.warn("[GTO] initRemoteRanges failed", err);
  }

  supabase
    .channel("gto_spot_ranges_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "gto_spot_ranges" },
      (payload) => {
        const row: any = payload.new ?? payload.old;
        if (!row?.spot_key) return;
        if (payload.eventType === "DELETE") REMOTE_CACHE.delete(row.spot_key);
        else REMOTE_CACHE.set(row.spot_key, normalizeRange(row.range));
        notifyAll();
      },
    )
    .subscribe();
}

/** Đọc range custom (nếu có) — cache đã pull từ DB qua initRemoteRanges. */
export function getCustomRange(key: SpotKey): Range | null {
  return REMOTE_CACHE.get(key) ?? null;
}

/** Lưu range custom vào DB (yêu cầu role super_admin theo RLS). */
export async function saveCustomRange(key: SpotKey, range: Range) {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id ?? null;
  const { error } = await supabase
    .from("gto_spot_ranges")
    .upsert({ spot_key: key, range: range as any, updated_by: uid }, { onConflict: "spot_key" });
  if (error) throw error;
  REMOTE_CACHE.set(key, range);
  notifyAll();
}

/** Xóa range custom (revert về hard-coded). */
export async function clearCustomRange(key: SpotKey) {
  const { error } = await supabase.from("gto_spot_ranges").delete().eq("spot_key", key);
  if (error) throw error;
  REMOTE_CACHE.delete(key);
  notifyAll();
}

// ---------- PER-USER PERSONAL RANGES ----------

/** Pull range cá nhân của user hiện tại từ DB + lắng nghe realtime. */
let _userInitStarted = false;
export async function initUserRanges() {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  if (!uid) return;
  if (_userInitStarted && _userCacheUid === uid) return;
  _userInitStarted = true;
  _userCacheUid = uid;
  USER_CACHE.clear();
  try {
    const { data, error } = await supabase
      .from("gto_user_spot_ranges")
      .select("spot_key, range")
      .eq("user_id", uid);
    if (!error && data) {
      for (const row of data as Array<{ spot_key: string; range: any }>) {
        USER_CACHE.set(row.spot_key, normalizeRange(row.range));
      }
      notifyUser();
    }
  } catch (err) {
    console.warn("[GTO] initUserRanges failed", err);
  }
  supabase
    .channel(`gto_user_spot_ranges_${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "gto_user_spot_ranges", filter: `user_id=eq.${uid}` },
      (payload) => {
        const row: any = payload.new ?? payload.old;
        if (!row?.spot_key) return;
        if (payload.eventType === "DELETE") USER_CACHE.delete(row.spot_key);
        else USER_CACHE.set(row.spot_key, normalizeRange(row.range));
        notifyUser();
      },
    )
    .subscribe();
}

export function getUserRange(key: SpotKey): Range | null {
  return USER_CACHE.get(key) ?? null;
}

export async function saveUserRange(key: SpotKey, range: Range) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Bạn cần đăng nhập để lưu range cá nhân");
  const { error } = await supabase
    .from("gto_user_spot_ranges")
    .upsert(
      { user_id: uid, spot_key: key, range: range as any, updated_at: new Date().toISOString() },
      { onConflict: "user_id,spot_key" },
    );
  if (error) throw error;
  USER_CACHE.set(key, range);
  notifyUser();
}

export async function clearUserRange(key: SpotKey) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from("gto_user_spot_ranges")
    .delete()
    .eq("user_id", uid)
    .eq("spot_key", key);
  if (error) throw error;
  USER_CACHE.delete(key);
  notifyUser();
}

/** Lấy range cuối cùng (custom DB > hard-coded > null). */
export function getPrecomputedRange(key: SpotKey): Range | null {
  return REMOTE_CACHE.get(key) ?? PRECOMPUTED.get(key) ?? null;
}

/** Lấy range cho user: ưu tiên range cá nhân của user > admin > hard-coded. */
export function getEffectiveRange(key: SpotKey): Range | null {
  return USER_CACHE.get(key) ?? REMOTE_CACHE.get(key) ?? PRECOMPUTED.get(key) ?? null;
}


export function hasPrecomputed(key: SpotKey): boolean {
  return !!getPrecomputedRange(key);
}

export function makeSpotKey(
  position: Position,
  spotType: string,
  depth: StackDepth,
): SpotKey {
  return `${position}_${spotType}_${depth}bb`;
}

export function getAllRegisteredSpots(): SpotKey[] {
  return Array.from(PRECOMPUTED.keys());
}

// -------------------- HELPERS --------------------

function a(fold: number, call: number, raise: number, allin: number): HandAction {
  return normalizeHandAction({ fold, call, raise, allin });
}

export function buildFullRange(overrides: Record<string, HandAction>): Range {
  const range: Range = {};
  for (const hand of allHands()) {
    range[hand] = overrides[hand] ?? a(1, 0, 0, 0);
  }
  return range;
}

function buildOpenRangeFromActionMap(actions: Record<string, GTOAction>): Range {
  const overrides: Record<string, HandAction> = {};
  for (const [hand, action] of Object.entries(actions)) {
    if (action === "raise") overrides[hand] = a(0, 0, 1, 0);
    if (action === "call") overrides[hand] = a(0, 1, 0, 0);
    if (action === "allin") overrides[hand] = a(0, 0, 0, 1);
  }
  return buildFullRange(overrides);
}

/** Export một Range thành snippet TS có thể paste lại vào file này. */
export function exportRangeSnippet(key: SpotKey, range: Range): string {
  const lines: string[] = [];
  lines.push(`registerSpot(${JSON.stringify(key)}, buildFullRange({`);
  for (const hand of Object.keys(range)) {
    const ha = range[hand];
    if (ha.fold >= 0.999) continue; // bỏ hand fold thuần
    const f = +ha.fold.toFixed(3);
    const c = +ha.call.toFixed(3);
    const r = +ha.raise.toFixed(3);
    const ai = +ha.allin.toFixed(3);
    lines.push(`  ${JSON.stringify(hand)}: a(${f}, ${c}, ${r}, ${ai}),`);
  }
  lines.push(`}));`);
  return lines.join("\n");
}

// ============================================================
// OPEN 50bb maps — source of truth from openRanges50bb.ts
// ============================================================

for (const position of ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB"] satisfies GTOPosition[]) {
  registerSpot(`${position}_OPEN_50bb`, buildOpenRangeFromActionMap(OPEN_RANGE_50BB[position]));
}

// ============================================================
// UTG OPEN 50bb — legacy snapshot kept for reference only.
// Disabled so it cannot override the source-of-truth OPEN maps above.
// ============================================================
/*

registerSpot("UTG_OPEN_50bb", buildFullRange({
  // Pairs
  "AA": a(0, 0, 1, 0), "KK": a(0, 0, 1, 0), "QQ": a(0, 0, 1, 0),
  "JJ": a(0, 0, 1, 0), "TT": a(0, 0, 1, 0), "99": a(0, 0, 1, 0),
  "88": a(0, 0, 1, 0), "77": a(0, 0, 1, 0), "66": a(0, 0, 1, 0),
  "55": a(0, 0, 1, 0), "44": a(0, 0, 1, 0), "33": a(0, 0, 1, 0),
  "22": a(0, 0, 1, 0),

  // Suited Ax
  "A3s": a(0, 0, 1, 0), "A4s": a(0, 0, 1, 0), "A5s": a(0, 0, 1, 0),
  "A6s": a(0, 0, 1, 0), "A7s": a(0, 0, 1, 0), "A8s": a(0, 0, 1, 0),
  "A9s": a(0, 0, 1, 0), "ATs": a(0, 0, 1, 0), "AJs": a(0, 0, 1, 0),
  "AQs": a(0, 0, 1, 0), "AKs": a(0, 0, 1, 0),
  "A2s": a(0.8, 0, 0.2, 0),

  // Suited Kx
  "K7s": a(0, 0, 1, 0), "K8s": a(0, 0, 1, 0), "K9s": a(0, 0, 1, 0),
  "KTs": a(0, 0, 1, 0), "KJs": a(0, 0, 1, 0), "KQs": a(0, 0, 1, 0),

  // Suited Qx
  "Q8s": a(0, 0, 1, 0), "Q9s": a(0, 0, 1, 0), "QTs": a(0, 0, 1, 0), "QJs": a(0, 0, 1, 0),

  // Suited Jx
  "J8s": a(0, 0, 1, 0), "J9s": a(0, 0, 1, 0), "JTs": a(0, 0, 1, 0),

  // Suited Tx
  "T8s": a(0, 0, 1, 0), "T9s": a(0, 0, 1, 0),

  // Suited 9x
  "98s": a(0, 0, 1, 0),

  // Offsuit
  "AKo": a(0, 0, 1, 0), "AQo": a(0, 0, 1, 0), "AJo": a(0, 0, 1, 0),
  "KQo": a(0, 0, 1, 0), "KJo": a(0, 0, 1, 0),
  "ATo": a(0.6, 0, 0.4, 0),
}));

// ============================================================
// UTG1 vs UTG Raise 2.3 (50bb)
// Raise 6.9: ~4.2% | Call: ~8.7% | Fold: ~87.1%
// ============================================================

registerSpot("UTG1_VS_3B_50bb", buildFullRange({
  // PURE RAISE
  "AA":  a(0, 0,    1,    0),
  "AKs": a(0, 0,    1,    0),
  "AQs": a(0, 0,    1,    0),
  "AKo": a(0, 0,    1,    0),

  // MIX RAISE / CALL (premium)
  "KK":  a(0, 0.15, 0.85, 0),
  "QQ":  a(0, 0.20, 0.80, 0),
  "JJ":  a(0, 0.50, 0.50, 0),

  "AJs": a(0, 0.20, 0.80, 0),
  "ATs": a(0, 0.40, 0.60, 0),

  "KQs": a(0, 0.50, 0.50, 0),
  "KJs": a(0, 0.40, 0.60, 0),
  "KTs": a(0, 0.40, 0.60, 0),

  "QJs": a(0, 0.50, 0.50, 0),
  "QTs": a(0, 0.50, 0.50, 0),

  "JTs": a(0, 0.70, 0.30, 0),

  "AQo": a(0, 0.15, 0.85, 0),
  "AJo": a(0, 0.15, 0.85, 0),
  "ATo": a(0, 0,    1,    0),
  "KQo": a(0, 0.20, 0.80, 0),
  "KJo": a(0, 0,    1,    0),
  "QJo": a(0, 0,    1,    0),

  // PURE / NEAR-PURE CALL
  "TT":  a(0, 0.60, 0.40, 0),
  "99":  a(0, 0.90, 0.10, 0),
  "88":  a(0, 0.90, 0.10, 0),
  "77":  a(0, 1,    0,    0),
  "66":  a(0, 0.95, 0.05, 0),
  "55":  a(0, 1,    0,    0),
  "44":  a(0, 1,    0,    0),
  "33":  a(0, 1,    0,    0),
  "22":  a(0, 1,    0,    0),

  "T9s": a(0, 1, 0, 0),
  "98s": a(0, 1, 0, 0),
  "87s": a(0, 1, 0, 0),
  "76s": a(0, 1, 0, 0),
  "65s": a(0, 1, 0, 0),

  // BLUFF 3-BETS
  "A9s": a(0.85, 0, 0.15, 0),
  "A5s": a(0.90, 0, 0.10, 0),
  "A4s": a(0.90, 0, 0.10, 0),
  "K9s": a(0.90, 0, 0.10, 0),
}));

// ============================================================
// BTN OPEN 50bb (folded to BTN) — GTO Wizard MTT 50bb
// Raise 2.3bb. Total open ~47%.
// ============================================================
registerSpot("BTN_OPEN_50bb", buildFullRange({
  // Pairs — all
  "AA": a(0,0,1,0), "KK": a(0,0,1,0), "QQ": a(0,0,1,0), "JJ": a(0,0,1,0),
  "TT": a(0,0,1,0), "99": a(0,0,1,0), "88": a(0,0,1,0), "77": a(0,0,1,0),
  "66": a(0,0,1,0), "55": a(0,0,1,0), "44": a(0,0,1,0), "33": a(0,0,1,0),
  "22": a(0,0,1,0),

  // Suited Ax — all
  "A2s": a(0,0,1,0), "A3s": a(0,0,1,0), "A4s": a(0,0,1,0), "A5s": a(0,0,1,0),
  "A6s": a(0,0,1,0), "A7s": a(0,0,1,0), "A8s": a(0,0,1,0), "A9s": a(0,0,1,0),
  "ATs": a(0,0,1,0), "AJs": a(0,0,1,0), "AQs": a(0,0,1,0), "AKs": a(0,0,1,0),

  // Suited Kx — all
  "K2s": a(0,0,1,0), "K3s": a(0,0,1,0), "K4s": a(0,0,1,0), "K5s": a(0,0,1,0),
  "K6s": a(0,0,1,0), "K7s": a(0,0,1,0), "K8s": a(0,0,1,0), "K9s": a(0,0,1,0),
  "KTs": a(0,0,1,0), "KJs": a(0,0,1,0), "KQs": a(0,0,1,0),

  // Suited Qx
  "Q4s": a(0.4,0,0.6,0), "Q5s": a(0,0,1,0), "Q6s": a(0,0,1,0), "Q7s": a(0,0,1,0),
  "Q8s": a(0,0,1,0), "Q9s": a(0,0,1,0), "QTs": a(0,0,1,0), "QJs": a(0,0,1,0),

  // Suited Jx
  "J6s": a(0.5,0,0.5,0), "J7s": a(0,0,1,0), "J8s": a(0,0,1,0),
  "J9s": a(0,0,1,0), "JTs": a(0,0,1,0),

  // Suited Tx
  "T7s": a(0.4,0,0.6,0), "T8s": a(0,0,1,0), "T9s": a(0,0,1,0),

  // Suited middle/low
  "97s": a(0,0,1,0), "98s": a(0,0,1,0),
  "86s": a(0.4,0,0.6,0), "87s": a(0,0,1,0),
  "75s": a(0.5,0,0.5,0), "76s": a(0,0,1,0),
  "64s": a(0.6,0,0.4,0), "65s": a(0,0,1,0),
  "54s": a(0,0,1,0), "53s": a(0.5,0,0.5,0),
  "43s": a(0.6,0,0.4,0),

  // Offsuit broadways / Ax
  "AKo": a(0,0,1,0), "AQo": a(0,0,1,0), "AJo": a(0,0,1,0), "ATo": a(0,0,1,0),
  "A9o": a(0,0,1,0), "A8o": a(0,0,1,0), "A7o": a(0,0,1,0),
  "A6o": a(0.3,0,0.7,0), "A5o": a(0.2,0,0.8,0), "A4o": a(0.4,0,0.6,0),
  "A3o": a(0.5,0,0.5,0), "A2o": a(0.6,0,0.4,0),

  "KQo": a(0,0,1,0), "KJo": a(0,0,1,0), "KTo": a(0,0,1,0),
  "K9o": a(0.3,0,0.7,0), "K8o": a(0.7,0,0.3,0),

  "QJo": a(0,0,1,0), "QTo": a(0,0,1,0), "Q9o": a(0.6,0,0.4,0),

  "JTo": a(0,0,1,0), "J9o": a(0.6,0,0.4,0),
  "T9o": a(0.5,0,0.5,0),
  "98o": a(0.7,0,0.3,0),
}));


// ============================================================
// SB OPEN 50bb (folded to SB) — GTO Wizard MTT 50bb
// Raise 3.5bb / Limp / Fold mix. Total play ~70% (raise ~45%, limp ~25%).
// Simplified to RAISE-only strategy (~50%) for clarity.
// ============================================================

registerSpot("SB_OPEN_50bb", buildFullRange({
  // Pairs — all play
  "AA": a(0, 0, 1, 0), "KK": a(0, 0, 1, 0), "QQ": a(0, 0, 1, 0),
  "JJ": a(0, 0, 1, 0), "TT": a(0, 0, 1, 0), "99": a(0, 0, 1, 0),
  "88": a(0, 0, 1, 0), "77": a(0, 0, 1, 0), "66": a(0, 0, 1, 0),
  "55": a(0, 0, 1, 0), "44": a(0, 0, 1, 0), "33": a(0, 0, 1, 0),
  "22": a(0, 0, 1, 0),

  // Suited Ax — all
  "A2s": a(0, 0, 1, 0), "A3s": a(0, 0, 1, 0), "A4s": a(0, 0, 1, 0),
  "A5s": a(0, 0, 1, 0), "A6s": a(0, 0, 1, 0), "A7s": a(0, 0, 1, 0),
  "A8s": a(0, 0, 1, 0), "A9s": a(0, 0, 1, 0), "ATs": a(0, 0, 1, 0),
  "AJs": a(0, 0, 1, 0), "AQs": a(0, 0, 1, 0), "AKs": a(0, 0, 1, 0),

  // Suited Kx
  "K2s": a(0.3, 0, 0.7, 0),
  "K3s": a(0, 0, 1, 0), "K4s": a(0, 0, 1, 0), "K5s": a(0, 0, 1, 0),
  "K6s": a(0, 0, 1, 0), "K7s": a(0, 0, 1, 0), "K8s": a(0, 0, 1, 0),
  "K9s": a(0, 0, 1, 0), "KTs": a(0, 0, 1, 0), "KJs": a(0, 0, 1, 0),
  "KQs": a(0, 0, 1, 0),

  // Suited Qx
  "Q4s": a(0.4, 0, 0.6, 0),
  "Q5s": a(0, 0, 1, 0), "Q6s": a(0, 0, 1, 0), "Q7s": a(0, 0, 1, 0),
  "Q8s": a(0, 0, 1, 0), "Q9s": a(0, 0, 1, 0), "QTs": a(0, 0, 1, 0),
  "QJs": a(0, 0, 1, 0),

  // Suited Jx
  "J6s": a(0.4, 0, 0.6, 0),
  "J7s": a(0, 0, 1, 0), "J8s": a(0, 0, 1, 0), "J9s": a(0, 0, 1, 0),
  "JTs": a(0, 0, 1, 0),

  // Suited Tx
  "T6s": a(0.5, 0, 0.5, 0),
  "T7s": a(0, 0, 1, 0), "T8s": a(0, 0, 1, 0), "T9s": a(0, 0, 1, 0),

  // Suited middle/low
  "97s": a(0, 0, 1, 0), "98s": a(0, 0, 1, 0),
  "87s": a(0, 0, 1, 0), "86s": a(0.3, 0, 0.7, 0),
  "76s": a(0, 0, 1, 0), "75s": a(0.4, 0, 0.6, 0),
  "65s": a(0, 0, 1, 0), "64s": a(0.5, 0, 0.5, 0),
  "54s": a(0, 0, 1, 0), "53s": a(0.6, 0, 0.4, 0),
  "43s": a(0.5, 0, 0.5, 0),

  // Offsuit broadways
  "AKo": a(0, 0, 1, 0), "AQo": a(0, 0, 1, 0), "AJo": a(0, 0, 1, 0),
  "ATo": a(0, 0, 1, 0), "A9o": a(0, 0, 1, 0), "A8o": a(0, 0, 1, 0),
  "A7o": a(0, 0, 1, 0), "A6o": a(0.3, 0, 0.7, 0),
  "A5o": a(0, 0, 1, 0), "A4o": a(0.2, 0, 0.8, 0),
  "A3o": a(0.5, 0, 0.5, 0), "A2o": a(0.6, 0, 0.4, 0),

  "KQo": a(0, 0, 1, 0), "KJo": a(0, 0, 1, 0), "KTo": a(0, 0, 1, 0),
  "K9o": a(0.2, 0, 0.8, 0), "K8o": a(0.5, 0, 0.5, 0),

  "QJo": a(0, 0, 1, 0), "QTo": a(0, 0, 1, 0),
  "Q9o": a(0.4, 0, 0.6, 0),

  "JTo": a(0, 0, 1, 0), "J9o": a(0.5, 0, 0.5, 0),

  "T9o": a(0.4, 0, 0.6, 0),
  "98o": a(0.6, 0, 0.4, 0),
}));
*/
