# Player Intelligence — MVP 1.5: Verified Data Audit + `get_player_intelligence` contract

Status: **draft / docs-only** (no code, no DB, no RPC, no migrations). This is the read-only audit and the
design contract that the later Verified Profile work (PR B onward) implements. It establishes what verified
tournament history VinPoker can derive **today** from existing tables, where the gaps are, and how the
private `get_player_intelligence` read RPC and the Scenario Outlook surface should be shaped — all within
the honest-statistics boundary (no winnings promise, no "prediction").

> Evidence below references `src/integrations/supabase/types.ts` (generated from the live DB), the
> `supabase/migrations/*`, and component usages. This is a snapshot for design; verify against live before
> any controlled apply.

---

## 0. Why this matters

The cold-start loop (Poker IQ Drill → Provisional Profile → Best Fit Events) is shipped. The moat is the
**next** step: connecting that profile to **real club results** so it becomes a *Verified Profile*, which
clubs can use to route players to the right tournaments. We should not add more standalone frontend until
the verified-data layer is designed.

**Headline finding.** VinPoker **already records exact finish positions live** in
`tournament_eliminations.position` (written per bust by the `record_hand` RPC, `NOT NULL`) — but that data
is **stranded**: `recompute_player_stats` (`supabase/migrations/20260428162343…sql`) reads **only** the
*manual* `player_results` table via a trigger, never the live tournament data. So the raw material for a
Verified Profile exists; the missing link is **aggregating live results into a profile**, not capturing them.

---

## 1. What's derivable today (evidence-based)

| # | Dimension | Verdict | Source / note |
|---|---|---|---|
| 1 | Total entries / player | ✅ reliable | `tournament_entries.entry_no` (maintained by `reenter_tournament_player`, `confirm_registration_and_assign_seat`) |
| 2 | Unique events vs re-entries | ✅ reliable | unique = distinct `tournament_id`; re-entry = `entry_no > 1` |
| 3 | ITM | ✅ reliable | `tournament_leaderboard_view.is_itm` (`position ≤ itm_places`, with fallback); `itm_places` kept in sync by trigger `20260917000000`. `prize` is **not** a reliable ITM signal (see #11) |
| 4 | Finish position (rank) | ⚠️ partial | EXACT for live-tracked busts (`tournament_eliminations.position`). **Missing** for players active at tournament end, for non-live-tracked events, and `tournament_entries.finished_place` exists but is **never written** |
| 5 | Final table | ❌ no marker | No explicit flag anywhere; only derivable as `position ≤ N` (N ambiguous). Real gap |
| 6 | Top 3 | ✅ when position present | `position ≤ 3` |
| 7 | Field size | ✅ reliable | best = `COUNT(DISTINCT player_id)` of `tournament_registrations` with `status = 'confirmed'`; snapshot = `tournaments.current_players` (may lag); `player_results.total_entries` is legacy |
| 8 | Buy-in band | ✅ reliable | `tournaments.buy_in` (always populated) |
| 9 | Structure band (deep/std/turbo) | ⚠️ weak | `minutes_per_level` + `starting_stack` are **nullable and often missing** (UI defaults `mpl → 20`). Don't rely — also why Best Fit lands many "standard" |
| 10 | Recent form | ⚠️ yes-but | derivable from `player_stats.last_20_results` / `avg_finish` — **but only from manual `player_results` today**; empty for most players until live data flows in |
| 11 | Data-quality gaps | — | `tournament_eliminations.prize` hardcoded **0** (never backfilled from `tournament_prizes`); `finished_place` never written; live results never aggregated into `player_stats`; no final-table marker; structure often null; **offline walk-ins** use synthetic ephemeral `player_id` (not joinable across events) |
| 12 | Missing closeout capture | — | (a) backfill `eliminations.prize` from `tournament_prizes` (matching `position`) — lightweight trigger; (b) mark final table at FT draw; (c) flow live finishes into a profile aggregate. None exist today |

### Identity caveat
- **Online players:** `player_id = auth.users.id`, joinable across events via `profiles.user_id`. Verified
  Profile works.
- **Offline walk-ins:** synthetic ephemeral `player_id` (`gen_random_uuid()`), name in
  `tournament_seats.player_name`, **not joinable** across events → no lifetime verified profile.

---

## 2. `source_quality` model (bake in from day 1)

Never silently guess — every derived dimension reports how it was sourced, so the UI can phrase confidence
honestly.

```ts
sourceQuality: {
  finishPosition: "exact_live" | "manual" | "missing";          // eliminations vs player_results vs none
  itm:            "leaderboard_view" | "itm_places" | "prize" | "manual";
  finalTable:     "derived_position" | "unknown";               // no exact marker exists yet
  fieldSize:      "confirmed_entries" | "current_players_snapshot" | "legacy_total_entries";
  structure:      "configured" | "default_assumed" | "unknown";
  identity:       "online_authenticated" | "offline_ephemeral"; // offline = not joinable across events
}
```

---

## 3. `get_player_intelligence(player_id)` — read RPC contract

Read-only, **player-scoped, deny-by-default**. Returns a safe **digest** aggregated from the LIVE data
(`tournament_entries` + `tournament_eliminations` + `tournament_leaderboard_view` + `tournaments`) — never
the stale `player_stats`, and never raw other-player finishes.

```ts
type PlayerIntelligence = {
  playerId: string;
  profileStatus: "new" | "provisional" | "verified";
  confidence: "low" | "medium" | "high";

  verifiedSample: { totalEntries: number; uniqueEvents: number; reentries: number; lastPlayedAt: string | null };

  results: {
    itmRate: number | null;
    finalTableRate: number | null;
    top3Rate: number | null;
    avgNormalizedFinish: number | null;   // (field_size - finish) / (field_size - 1)
    recentFormDelta: number | null;
  };

  bands: { bestBuyInBand: string | null; bestFieldSizeBand: string | null; bestStructure: "deep" | "standard" | "turbo" | null };

  sourceQuality: SourceQuality;           // §2
  scenarioOutlook: ScenarioOutlook;       // §4
  locked: { scenarioOutlook: boolean; dreamLadder: boolean };
};
```

**Privacy posture.** Existing `player_stats` and `player_results` are **fully public** (`USING (true)`);
`tournament_eliminations` / `tournament_entries` are authenticated-only. The *private* intelligence (leaks,
odds, training, best-fit) must live behind this **new deny-by-default, player-scoped RPC** — do **not** pile
private data onto the existing public tables. Existing public reads (Leaderboard / FindBacker /
PlayerProfile) are untouched.

---

## 4. Scenario Outlook ("Viễn cảnh 4 / 8 / 12 giải") — private, verified-gated

The "4 giải → ~1 ITM · ≥1 ITM 68%" surface is the strongest dream-seller, but it ships as a **simulation of
verified history — NEVER a "prediction"**. Private-only. **Locked** for drill-only / provisional profiles;
unlocked only after verified data + adequate `source_quality`.

### Math (server-computed; frontend renders only)
- `expectedItm = N × shrunkItmRate`
- `chanceAtLeastOneItm = 1 − (1 − shrunkItmRate)^N`  (same form for final-table with the FT rate)
- Use the **shrunk** rate (shrunk toward the club/peer mean for small samples) and always show a **range**
  and **confidence** — never the naïve point estimate.
- Example, `itmRate = 25%`, `N = 4`: expected `~1` (range `0–2`), `chanceAtLeastOneItm ≈ 68%`, confidence Medium.

### Unlock gate
`verifiedEntries ≥ 8–10` **AND** `finishPosition`/`itm` source-quality adequate. Else show the locked teaser:
> "Viễn cảnh 4 / 8 / 12 giải — đang khóa. Chơi thêm vài giải thật tại VinPoker để mở khóa ITM outlook."

### RPC block
```ts
scenarioOutlook: {
  unlocked: boolean;
  reasonLocked?: "not_enough_verified_entries" | "low_source_quality";
  basedOn: { verifiedEntries: number; similarEntries: number; itmRate: number | null; shrunkItmRate: number | null; confidence: "low" | "medium" | "high" };
  windows: Array<{
    tournaments: 4 | 8 | 12;
    expectedItm: number | null;
    expectedItmText: string;        // "~1"
    itmRangeText: string;           // "0–2"
    chanceAtLeastOneItm: number | null;
    finalTableChance?: number | null;
  }>;
  disclaimer: string;
}
```
Server returns rate + confidence + `source_quality` + windows; the **frontend never computes odds from raw
multi-player finishes.** No monetary EV anywhere.

### Wording
- ✅ "Dựa trên kết quả đã ghi nhận, nếu chơi 4 giải tương tự, hồ sơ của bạn có kỳ vọng khoảng 1 lần ITM. Đây
  là mô phỏng xu hướng, không phải cam kết." · "Cơ hội có ít nhất 1 ITM: 68% · Độ tin cậy: Trung bình."
- Microcopy under the numbers: "Mô phỏng dựa trên kết quả đã ghi nhận tại club và các giải có cấu trúc tương
  tự. Không phải cam kết kết quả." (always-visible disclaimer)
- ❌ Forbidden: "Bạn sẽ ITM 1 lần mỗi 4 tour." · "AI dự đoán bạn ITM." · "Chắc chắn có ITM." · any
  "prediction / dự đoán / guaranteed / chắc chắn".

### Privacy
Private-only. Public profile may show "Verified · Tight Solid · ITM badge"; Expected ITM / `P(≥1)` / FT
outlook / leaks / training / best-fit stay private.

---

## 5. Honest-copy ladder (standardize across the feature)

| Stage | Copy |
|---|---|
| Drill-only | "Hồ sơ tạm tính từ bài drill. Chưa dựa trên kết quả giải thật." |
| Best Fit | "Gợi ý dựa trên phong cách drill và cấu trúc giải, không phải dự đoán kết quả." |
| Verified | "Dựa trên kết quả đã ghi nhận tại club. Vẫn chỉ là xu hướng, không phải cam kết." |

---

## 6. Roadmap rebaseline

```
MVP1   Poker IQ Drill + Provisional Profile        ✅ merged (#338)
MVP1.1 Best Fit Events Lite                         ✅ #352 (draft)        [was called "MVP3"]
MVP1.2 Tournament Fit Badge                         folds into Best Fit / later
MVP1.3 Local-only result persistence                parked
MVP1.5 Verified Data Audit + contract               ◀ THIS doc
MVP2   Verified Player Journey (read RPC + panel)    after audit
MVP3   Scenario Outlook + Dream Ladder               only after verified data is trustworthy
```

---

## 7. Rollout (each step owner-gated; no risky code in this doc)

- **PR A — this doc** (docs-only). Zero risk.
- **PR B** — source-only migration: `get_player_intelligence` read RPC over LIVE data, player-scoped,
  deny-by-default, with `source_quality` + `locked` flags. Derive final-table from position. Controlled apply
  (snapshot → single object → verify → rollback note).
- **Capture-gap (separate, highest caution — touches live write paths):** `eliminations.prize` backfill
  trigger from `tournament_prizes`; optional final-table marker at FT draw. Golden-period before/after diff +
  rollback.
- **PR C** — frontend Verified Profile panel (reads the RPC).
- **PR D** — unlock Scenario Outlook only when `source_quality` is good enough; else keep the locked teaser
  (drill-only can't compute ITM/FT odds honestly).
