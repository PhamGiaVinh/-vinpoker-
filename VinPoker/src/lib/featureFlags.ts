// Feature flags for staged rollout of cashier/floor features.
// Flipping a flag is a one-line commit — keep defaults SAFE (hidden) until the
// owner's production UAT passes (plan: Seat Floor Cashier UX, 2026-06-13).
export const FEATURES = {
  /**
   * Cashier "Đăng ký giải" tab — confirm a PENDING online registration → auto-draw
   * seat → receipt (via the live confirm_registration_and_assign_seat RPC).
   * ENABLED in production 2026-06-14 after preview UAT passed (#148). Visible to all
   * cashiers. Kill-switch: set false to hide from regular cashiers (admins/club
   * owners still see it).
   */
  cashierRegistrations: true,
  /**
   * Cashier "Buy-in tại quầy" (offline cash / walk-in): pick tournament → name →
   * buy-in + fee → auto-draw seat + receipt via `create_offline_buyin_and_seat`.
   * ENABLED 2026-06-14: RPC applied live + hardened (PUBLIC/anon revoked) in a
   * controlled session, owner UAT passed. Now the section is visible to all
   * cashiers and the Buy-in button calls the live RPC. Kill-switch: set false to
   * hide the section from regular cashiers (admins/owners keep it) and disable the
   * button ("Cần bật RPC").
   */
  offlineBuyIn: true,
  /**
   * Registration extensions for cashiers: VOID (cancel a confirmed registration →
   * free seat + refund + revenue auto-reverse, via `void_registration`) and
   * RE-ENTRY (re-buy a busted player → new entry + seat + receipt, via
   * `reenter_tournament_player`). Default **OFF** because both need their RPCs
   * applied live first (`20260901000000` + `20260901000001`). While false: the
   * Void buttons are hidden in the registration lists, and the "Re-entry" panel —
   * shown to admins/club owners for UAT — keeps its action button disabled
   * ("Cần bật RPC") and never calls a missing RPC. Flip to true ONLY after the two
   * RPCs are applied live in a controlled DB session.
   */
  registrationExtensions: false,
  /**
   * SePay reconciliation — Cashier "Đối soát SePay" tab. Surfaces the reconcile worklist
   * (SePay-API-verified transfers) via the read-only `sepay_cashier_settlement_worklist` RPC, so a
   * cashier can confirm (→ `manual_confirm_bank_transaction`) or ignore (→ `ignore_bank_transaction`).
   * Default **OFF**: hidden from regular cashiers (admins/club owners still see it for UAT). Flip true
   * ONLY after the worklist RPC (`20261116000000`) + the reconcile chain (`20261113`–`20261115` + the
   * sepay-reconcile edge fn) are applied live and owner UAT passes.
   */
  sepayReconcile: false,
  /**
   * SePay auto-confirm UI mirror — reserved status indicator for the server-side `SEPAY_AUTO_CONFIRM`
   * env kill-switch. NOT used in v1 (Direction 1 is flag-only; the cashier confirms manually). Keep false.
   */
  sepayAutoConfirm: false,
  /**
   * Dynamic VietQR on the tournament buy-in screen (TournamentRegisterModal). When ON, the payment
   * card renders a NAPAS VietQR (built locally) that pre-fills the receiving account + exact amount +
   * the bare reference_code memo, so the customer can't mistype them → reliable SePay auto-confirm.
   * Frontend-only; does NOT touch settle/confirm. The QR carries no data settle trusts — it is a
   * convenience pre-fill; the static QR + manual fields stay as fallback. For production the BIN comes
   * from an explicit platform_bank_accounts.bank_bin (Stage 2 #577); the free-text name map is a
   * legacy/UAT fallback only.
   * **ON 2026-06-29** after the owner's real MB bank-app scan passed (account + amount + memo pre-filled
   * correctly) and the receiving account's explicit bank_bin (MB 970422) was set via the picker.
   * Kill-switch: set false to instantly revert to the static QR (no other change needed).
   */
  dynamicVietQr: true,
  /**
   * Player-facing online RE-ENTRY (PATCH 4): a busted player whom the floor removed can self-buy back in —
   * tap "Mua lại" → REENTRY dynamic VietQR → pay → SePay full-auto re-seats. Default **OFF**. While false,
   * TournamentDetail behaves EXACTLY as before (no re-entry queries run, no source_entry_id reference — safe
   * even before the STAGE-B migration is applied) and the "Mua lại" button is hidden. Flip to true ONLY after
   * STAGE A/B/C migrations are applied live, the headless tests pass, the tournament-reentry edge fn is
   * deployed, and the club is opted in (same as the initial full-auto). Kill-switch: set false to hide the
   * re-entry path instantly.
   */
  dynamicReentry: true,
  /**
   * Move-player dialog + System-A row locking (used by the floor map "Sơ đồ bàn"
   * + the registration queue; the standalone Table Draw tab was removed 2026-06-15).
   * Enabled 2026-06-13: guard v2 (20260818000000) APPLIED LIVE and verified —
   * actor bound to auth.uid(), PUBLIC/anon execute revoked, spoof/anon/noop
   * tests passed (see controlled patch session report).
   */
  movePlayer: true,
  /** Realtime queue updates — requires tournament_registrations in the realtime publication. */
  registrationRealtime: false,
  /**
   * Dealer Swing "Sửa nhầm bàn" wrong-table correction modal (#33C).
   * Backend reconcile_dealer_room_state is LIVE (20260817000002 + club-scope
   * fix 20260818000002, both applied 2026-06-13 in controlled sessions).
   * Kill-switch: flipping to false restores the disabled placeholder button.
   */
  wrongTableCorrection: true,
  /**
   * Dealer Swing "Sửa domino nhiều bàn" multi-table room-reconcile wizard (#33F).
   * Same LIVE backend reconcile_dealer_room_state (incl. park-and-place swap
   * fix 20260819000004). Default OFF for owner UAT — flip to true is one line.
   * Independent of wrongTableCorrection.
   */
  roomReconcileWizard: false,
  /**
   * Remote TD AI: lets the assistant call the `td-ai-assistant` Edge Function so
   * it gives real AI advice across rulings, tournament operations, floor
   * procedure and basic strategy — grounded ONLY in the committed corpus
   * (no-hallucination validator drops any uncited/fabricated rule). The provider
   * is configured by Edge secrets, NOT hardcoded: `TD_AI_PROVIDER` (gemini
   * default / groq / openrouter) + `TD_AI_MODEL` + the matching key
   * (`GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`). **ON**
   * (owner-approved): the function is in the Deploy Edge Functions step so it
   * ships on merge. `useTdAi` calls it and STILL falls back to the offline
   * keyword corpus on ANY failure (function absent, network, quota/429, missing
   * key), so the panel keeps working even if the model is unavailable.
   * Kill-switch: set false to force the offline-only path. Advisory only.
   */
  tdAiRemote: true,
  /**
   * Online Poker UI under /poker/* — friends-practice model. **ON** (2026-06-17):
   * the open-table rework (#293) is live — migration 20260921000000 applied (host_user_id
   * + op_create_open_table/op_sit_open/op_transfer_host/op_leave_open_table), edge deployed,
   * online_poker_config.enabled=true, crons active. 2-disposable-account E2E passed
   * (create→host · sit_open · auto-deal · play · transfer_host · leave→reassign). Players
   * create open tables, self-set their own chips (no wallet), first sitter is the host
   * (transferable + auto-reassign). Kill-switch: set false to restore <PokerComingSoon/>.
   */
  onlinePoker: true,
  /**
   * Online Poker REBUY — the "Mua thêm chip" button in the bustout dialog. Default
   * **OFF**: while false the button stays disabled ("sẽ bổ sung sau"). This is a UI gate
   * ONLY, NOT a security gate — the real gate is the `op_rebuy_open` RPC being unapplied.
   * Flip to true ONLY after migration 20260929000000 is applied live (E5B) and edge
   * deployed. The RPC server-dictates the amount (= table starting_stack_default) and is
   * busted-only, so it never lets the client set an arbitrary stack.
   * E5B DONE 2026-06-19: op_rebuy_open applied live (Management-API, grants verified,
   * schema_migrations untouched) + edge redeployed with rebuy_open. Enabled here for
   * Preview UAT; merge to production only after owner confirms busted→rebuy→stack-returns.
   */
  onlinePokerRebuy: true,
  /**
   * Club Admin → Owner Finance Dashboard at /club/admin/finance. Read-only money-flow
   * (staking fees + staking payout fees + tournament rake − SAVED dealer payroll; never
   * recomputes payroll). Default **OFF** (dark). While false the route + the ClubAdmin
   * entry link are hidden from everyone except super_admin (so the owner can UAT). Flip
   * to true after owner UAT (and optionally once the get_club_finance_summary read RPC
   * ships in Phase 3). No DB writes.
   */
  clubFinanceDashboard: false,
  /**
   * Owner "Tài chính & Đối soát" (Accounting Control) cockpit at /club/admin/accounting-control.
   * UI/CLIENT-ONLY SHELL: 11 tabs (Tổng quan · Chốt sổ · Event P&L · Series P&L · Tiền & Bank ·
   * Phải trả giải · F&B · Lương & chi phí · Ký quỹ staking · Cảnh báo · Báo cáo tháng) rendered
   * ENTIRELY from typed mock fixtures — NO DB/RPC/Edge/types import, no writes, zero money-path
   * logic; the lazy chunk never touches the supabase client. Every money value carries a
   * data-state badge (Dự báo/Tạm tính/Đã đối soát/Đã chốt); prize pool + escrow are styled as
   * liability/custody, never revenue; contribution is never labeled "profit". Tabs "Chốt sổ" &
   * "Báo cáo tháng" are SPEC/NOT-BUILT mocks of the Daily Close / Monthly Report contracts.
   * Was OFF (dark) during build; **ON 2026-07-03 at owner's explicit request** ("bật với mọi
   * club") so every club owner/admin can review the mock cockpit from the VẬN HÀNH menu +
   * ClubAdmin card. STILL UI/mock/read-only — flipping this shows a clearly-labelled
   * "DỮ LIỆU MẪU (mock)" page; it touches NO money path. Kill-switch: set false to hide the
   * page + both entry points again. Real data wiring is a later, separately-flagged phase —
   * see docs/design/accounting-control-ui.md.
   */
  accountingControl: true,
  /**
   * Accounting Control — W1: wire the "Tổng quan" tab to REAL read-only data from the live
   * `get_club_finance_summary` RPC (via `useClubFinanceSummary`, RLS-scoped to the owner's club,
   * current month). When ON, the "Tiền của club" block shows real retained revenue + saved dealer
   * wage cost + "còn lại sau lương" (all Tạm tính — actuals-to-date, not closed); the GTD subsidy,
   * the "Tiền giữ hộ" (pool/payout/escrow) block, the entries forecast, and every other tab stay
   * MOCK, clearly tagged "(mock — chưa nối)". Read-only — no writes, no new RPC. PT-wage line and
   * F&B stay a known gap until #656 R2 applies live + their own increments (see
   * docs/design/accounting-control-wiring-plan.md). While false, Tổng quan renders today's mock
   * exactly (zero extra reads). **ON 2026-07-03 at owner request** (after #656 R1/R2/R3 applied
   * live) — Tổng quan "Tiền của club" now shows real numbers; golden-diff = they must equal
   * /club/admin/finance for the same month. Kill-switch: set false to revert to mock.
   */
  accountingControlLiveOverview: true,
  /**
   * Blind editor "Lưu" (full-replace save) in BlindEditorPanel. Default **OFF**
   * because it needs the source-only `update_blind_structure` RPC
   * (20260825000000) applied live first. While false the editor is usable as a
   * read-only / draft-local preview and Save shows disabled "Cần bật RPC" — it
   * NEVER calls the RPC, so it can't silently fail or wipe the live structure.
   * Flip to true ONLY after the RPC is applied live in a controlled DB session.
   */
  blindEditorSave: true,
  /**
   * Reusable blind-structure templates ("thư viện cấu trúc blind"). Default **OFF**
   * because it needs both the `update_blind_structure` RPC (20260825000000) AND the
   * `blind_structure_templates` table (20260920000000) applied live first. While
   * false: no template UI renders ("Lưu thành mẫu" / "Tải mẫu" in the blind editor
   * and the "Cấu trúc blind" picker in Tạo giải are hidden) so nothing queries the
   * missing table. Flip to true ONLY after both objects are applied in a controlled
   * DB session (the editor full-replace path also requires blindEditorSave=true).
   */
  blindTemplates: true,
  /**
   * Dealer Shift Planner V2.1 — "Xếp lịch dealer" tab in DealerSwingDashboard
   * (staff scheduling: schedule dealers per day/week with flexible check-in times,
   * SEPARATE from the live Dealer Swing rotation system). **ON** (2026-06-14, post-UAT):
   * migration `20260827000000_dealer_shift_planner.sql` is applied live and the tab
   * runs in mode="live". With this true, ALL dealer-control staff (not just
   * owner/admin) see the tab on the Dealer Swing page. Save/Publish is Phase 2C.
   */
  dealerShiftPlanner: true,
  /**
   * Dealer Shift Planner V2 — guided 4-step redesign of the "Xếp lịch dealer"
   * tab (owner-approved mockups 2026-07-02): week strip + Tạo lịch → Thêm thủ
   * công (pick-from-list) → Rà soát → Phát hành & báo dealer (one action =
   * save + publish + Telegram + app), actionable dealer requests, day/week
   * image exports. Same RPCs as V1 (save_shift_run / publish_shift_run /
   * send-shift-schedule) — pure UI/flow change. OFF until owner UAT; while
   * false, the V1 ShiftPlannerTab renders unchanged (instant kill-switch).
   */
  shiftPlannerV2: false,
  /**
   * Tracker Live Action Engine MVP — live per-action playback on the public
   * tournament viewer (/live/:id). While a hand is in_progress, the viewer
   * fast-polls so spectators see each recorded action in near-real-time
   * (`record_action` only writes `hand_actions`, which fires no
   * `tournament_hands` realtime event, so the default path updates only after
   * the hand is finalised). Frontend-only — no DB/publication change; a later
   * phase can swap the fast-poll for a `hand_actions` realtime subscription
   * (controlled publication op).
   *
   * **ON** (RPT-style live chips): drives the spectator's per-seat committed-chip
   * pills (`current_bet`), the colored flying chips, and the "◀ chờ" whose-turn
   * spotlight. ALL of its effects are VIEWER-ONLY — the fast-poll is `spectator`-
   * gated + visibility-aware, the toActId pass is `spectator`-gated, and the bet
   * pill renders only under `viewerLayout` — so the operator/TV are byte-identical.
   * Kill-switch: set false → the viewer falls back to realtime + 30s polling (no
   * live pills/spotlight), exactly as before.
   */
  liveActionEngine: true,
  /**
   * Spectator HAND FEED — an RPT-Live-style "completed hands" feed on the public
   * viewer (/live/:id): one rich card per completed hand (tags ALL-IN/BIG POT/HIGH
   * HAND/Eliminated, pot in chips + BB, board, per-player chip delta abs&BB, revealed
   * or face-down hole cards, winner). READ-ONLY: derived entirely from already-
   * persisted data (tournament_hands / hand_players / hand_actions / eliminations);
   * no write-path / RPC / Edge / publication change. Default **OFF**: while false the
   * viewer renders exactly as today (the feed hook never mounts → zero extra reads).
   * Flip true (after UAT on a preview branch) to show the feed; kill-switch = false.
   *
   * 🟢 HOLE-CARD GUARANTEE: hole_cards are persisted ONLY when the operator reveals
   * them at showdown/runout (already face-up at the physical table); there is NO
   * hidden/RFID hole-card source, and this feed shows COMPLETED hands only → the
   * viewer can never know more than the table showed → no leak, no delay needed.
   * ⚠️ If an RFID / hole-card-camera source is ever added, this guarantee BREAKS and
   * a broadcast delay + reveal policy becomes mandatory before showing any hand.
   */
  liveHandFeed: true, // GO-LIVE 2026-06-22: spectator hand feed enabled (owner-approved)
  /**
   * Live-tracker table FX (presentational): a chip-push-to-pot animation on
   * bet/call/raise/all-in + a card-reveal-once stagger on the felt, enriched synth
   * sounds (flop riffle / turn / river deal swooshes, card-muck fold, chip clink),
   * AND the same sounds + chip-push fired while a hand is PLAYED back in replay
   * ("Phát lại"). ADDITIVE: visual FX (chip-push / board stagger) is gated by the
   * LiveFelt PROPS the VIEWER passes, so operator / TV stay byte-identical at RUNTIME.
   * When OFF: viewer + replay render + sound exactly as today (replay is silent, as it
   * always was). Frontend-only. Kill-switch: set false.
   */
  liveTableFx: true, // GO-LIVE 2026-06-22: chip-push + enriched sounds + replay audio (owner-approved)
  /**
   * Public live-tracker EVENT TABS (RPT-Live style): opening `/live/:id` no longer
   * drops straight onto the felt — it shows a 5-tab event page (Cập nhật / Lịch sử
   * ván / Giải thưởng / Cấu trúc / Hình ảnh). The felt mounts ON DEMAND (tap the
   * "Bàn đang chơi" card to watch live, or a hand to replay). Public-viewer-only
   * (LiveHub); TournamentLiveView/operator/TV untouched. OFF → today's stacked
   * layout (felt always shown), byte-identical. Frontend-only. Kill-switch: set false.
   */
  liveEventTabs: true,
  /**
   * ── Tracker Ops + Viewer UX upgrade program (RPT parity, plan 2026-07-02) ──
   * PR-F0 flag bootstrap: ALL program flags land here FIRST (default OFF) so the
   * parallel batch PRs never touch this file again (no rebase conflicts). Each flag
   * flips ON individually after its batch passes owner UAT — one-line commits.
   */
  /**
   * PR-O1 (A1): operator blind auto-seed — SB/BB/ante auto-fill from the live
   * `get_tournament_clock` level on every new hand (with provenance "Level N ·
   * SB/BB · fetched at HH:MM"), stale-level banner shows next-hand amounts, one-tap
   * blind posting. Clock fetch failure → manual entry (NEVER auto-fill zero).
   * Amounts stay editable — a confirm assist, not a silent mutate. Frontend-only.
   */
  trackerBlindAutoSeed: false,
  /**
   * PR-O1 (A2): "Ván tiếp theo →" express CTA after record_hand — carries hand
   * number + button suggestion + blinds (A1) to start-confirm in one step, with a
   * double-click guard (no duplicate/orphan hands). Frontend-only.
   */
  trackerNextHandExpress: false,
  /**
   * PR-O2 (A3): in-console chip quick-edit (same `update_seats` Edge call as
   * EditChipsDialog — no new backend) + pre-submit projected-stack preview in
   * review. Chip-integrity guards: between-hands only, reason required, server-
   * confirmed base, re-fetch after update (no optimistic drift). Frontend-only.
   */
  trackerChipQuickEdit: false,
  /**
   * UAT wave 2 (Fix 1): cover-call all-in runout auto-flow. When ON: once a covering
   * stack's call closes betting with everyone else all-in, the engine waives the lone
   * coverer's pointless per-street "check" (isRoundComplete true / actorToAct null via
   * EngineState.coverCallWaiver), so the board runs out enter_flop → enter_turn →
   * enter_river with no action states; the runout reveal panel also gains a guarded
   * "Tiếp tục không lật" escape when the operator has no hole-card info. OFF (default):
   * behavior byte-identical to today — THE COVER-CALL BUG REMAINS until this flips.
   * Operator-only; no server change (client simply stops sending runout-street actions).
   * **ON 2026-07-03** for owner UAT (no external users; #674 merged). Kill-switch: set false.
   */
  trackerCoverCallRunout: true,
  /**
   * Showdown reveal ORDER (viewer): at showdown the showing players' hole cards
   * flip IN SEQUENCE (last aggressor on the final street first, else first-to-act
   * from the SB, then clockwise) ~0.5s apart, instead of all at once. Implemented
   * as a viewer-side staggered card-reveal animation ordered by the pure
   * `showdownRevealOrder()` — reliable regardless of poll cadence; works live +
   * replay. The operator still enters all cards + one "Lật bài" (the showdown panel
   * just lists players in reveal order with a ①②③ hint). OFF (default): cards reveal
   * simultaneously as today (byte-identical). Reduced-motion → no stagger.
   * Frontend-only; no DB/RPC/Edge change (broadcast unchanged).
   * **ON 2026-07-03** for owner UAT (no external users; #682 merged). Kill-switch: false.
   */
  trackerShowdownRevealOrder: true,
  /**
   * PR-V1 (B1): replay HUD parity — BB/ANTE + to-act + POT bar under the felt,
   * SUMMARY|ACTIONS tabs (winner rows ±BB + hand-summary bullets from revealed data
   * only), prev/next hand + jump-to-end (silent) + breadcrumb. Viewer-only;
   * unreliable frame data → field hidden (best-effort, never fake). Frontend-only.
   */
  liveReplayHud: false,
  /**
   * PR-V2 (B2): compact-wide RPT-style felt on portrait phones (felt ≈ ⅓ of the
   * viewport, pods around the rim, stacks in BB, controls+summary below). Viewer-only
   * variant — operator/TV byte-identical is a hard merge gate (full-render equality
   * test + before/after screenshots + DOM diff). HIGHEST-RISK visual flag.
   * PR-A1 (#666) merged the implementation dark; flipped ON here for OWNER VISUAL UAT
   * (no external users → owner-only preview). Rollback: set back to false.
   */
  liveFeltCompact: true,
  /**
   * PR-V3 (B3): viewer "moments" — pot-collect sweep at street end, elimination
   * moment, level-up toast, header Reload. Reduced-motion guarded; no auto-sound;
   * animations never block state updates. Frontend-only.
   */
  liveMoments: false,
  /**
   * PR-N1 (B5): SPOTLIGHT editorial posts (staff commentary + photo on the public
   * feed). TWO-TIER GATE: while false the UI NEVER queries `tournament_posts`; if
   * flipped true before the source-only migration is owner-applied, the UI catches
   * the missing table (42P01) and renders a disabled "chưa áp dụng" state — never a
   * crash. Flip ONLY after the owner applies the migration in a controlled session.
   */
  liveSpotlightPosts: false,
  /**
   * Viewer Felt V2 — responsive, CoinPoker-style public spectator poker table.
   * Fixes the mobile bug where hole cards overlap each other / the central board by
   * sizing every card with the felt's own width (CSS container query + clamp), and
   * (PR-B) ships premium geometry + compact pods. PUBLIC-VIEWER-ONLY: gated by the
   * LiveFelt `viewerLayout` prop, which `TournamentLiveView` sets ONLY when
   * `spectator` (LiveHub is the sole setter of spectator=true) — so operator hand
   * input + TV stay byte-identical. When false the felt renders exactly as today.
   * The V2 path also forces its own neon premium surface, so the redesign never
   * depends on `liveHandFeed`/`viewerNeon` being on. Frontend-only. Kill-switch: set false.
   */
  liveViewerFeltV2: true,
  /**
   * Tracker Engine Mode (Phase 1) — engine-assisted operator Hand Input. While
   * ON, the pure `trackerEngine` drives action order (correct heads-up / 3+
   * seeding), legal actions, "Bet to" (street-total) sizing, automatic
   * betting-round close + local street progression, and fold-win / simple
   * selected-winner settlement pre-fill — with manual tap-any-seat override kept
   * (out-of-turn shows a warning, not a hard-block). Default **OFF**: while false
   * the operator flow is the existing manual path (except the always-on pre-start
   * guard requiring an explicit dealer-button selection). Frontend-only — no
   * DB/RPC/Edge; settlement persists via the existing `record_hand` ending_stack
   * payload and the live viewer reads street from community_cards / hand_actions
   * as today. Phase 2 adds the hand evaluator + exact side-pot settlement.
   *
   * Restored to the documented OFF default 2026-06-19: PR #313 (a "[DO NOT MERGE]
   * UAT preview" branch) was merged by accident and flipped this to true on main,
   * shipping the un-UAT'd engine flow to ALL operators with no runtime toggle.
   * Real Engine Mode UAT must run on a preview branch (flag ON) while main/prod
   * stays OFF — never via main.
   */
  trackerEngineMode: false,
  /**
   * Standalone operator Hand Input console (`/tracker/hand-input`) — the full-screen
   * floor-control surface (2-col desktop / 3-tab mobile) per the approved mockup.
   * Decoupled from `trackerEngineMode`: this flag ONLY enables the standalone console
   * (page mount + the "open console" entry button in the operator Nhập-hand tab); it
   * does NOT change the embedded HandInputPanel. The console reuses the SAME engine
   * write-path (7 Edge payload builders) as the embedded panel — no DB/RPC/Edge change.
   * Default **OFF**: while false the route shows a friendly notice, never mounts the
   * controller hook, and the entry button is hidden → zero change to the live operator
   * flow. Flip to true (after operator UAT on the preview branch) to let floor staff
   * open the new console. Kill-switch: set false to instantly hide it again.
   */
  trackerHandInputConsole: true, // GO-LIVE 2026-06-21: operator console enabled as the racetrack (owner-approved)
  /**
   * Racetrack operator console — when ON, `/tracker/hand-input` renders the
   * RacetrackHandInputConsole (TrackerRacetrack felt + ActionDock) instead of the
   * LiveFelt-based StandaloneHandInputConsole. BOTH use the SAME `useStandaloneHandInput`
   * hook + the same guided sub-panels, so every engine feature (settlement / runout /
   * elimination / dead-button) is identical — only the felt + action-step presentation
   * differ. Default **OFF**: the route keeps the existing StandaloneHandInputConsole, so
   * production is unchanged. Flip to true (after operator UAT) to make the racetrack live.
   */
  trackerRacetrackUi: true, // GO-LIVE 2026-06-21: racetrack IS the operator console (owner-approved)
  /**
   * Racetrack RICH felt — additive visual enrichment of <TrackerRacetrack>: per-seat
   * hole cards (face / face-down) + avatars, main+side-pot chips, a distinct
   * engine-suggestion cue, a pre-hand waiting overlay, responsive portrait/landscape
   * seat maps, and the burgundy+gold poker-felt skin (reusing the existing
   * --poker-felt/--poker-gold tokens + PokerCard/CardBack). Presentational ONLY — it
   * reads MORE of the data the hook already produces (playerHoleCards, potBreakdown,
   * avatar_url, engineActor) and changes NO write-path / engine / RPC / Edge. Default
   * **OFF**: while false the console passes ONLY today's props, so the racetrack renders
   * byte-identical to the current live console (mirrors LiveFelt's opt-in physicalSeats
   * pattern). Flip to true (after operator UAT on the preview branch) to make the
   * richer table live; kill-switch = set false.
   */
  trackerRacetrackRich: true, // GO-LIVE 2026-06-22: rich operator felt enabled (owner-approved)
  /**
   * Dealer Mobile App (/dealer/*) — dealer-facing portal over the Shift Planner
   * V2.1 layer (view shifts, confirm, ROSTER check-in/out, careers/marketplace).
   * **ON** (2026-06-16, owner-approved launch for dealer UAT): the app is visible
   * to all users and runs on LIVE data (source = "live" since `dealerShiftPlanner`
   * is also ON + its additive migration `20260827000000` is applied). Un-logged-in
   * visitors to /dealer now see <DealerLogin/> (account code + password the Telegram
   * bot issues, or the one-tap magic link) instead of the shared email login. Reads
   * only `dealer_shift_assignments` / `dealers` / `profiles`; NEVER touches the live
   * Dealer Swing / attendance / payroll tables. Self-service write RPCs
   * (confirm/check-in, Migration A) + careers tables (Migration B) are NOT applied
   * live yet, so the action buttons stay preview-only (toast) and careers tabs run
   * on mock — no missing-table crashes. Kill-switch: set false to re-hide the app
   * (back to <DealerComingSoon/> for non-admins).
   */
  dealerMobileApp: true,
  /**
   * Dealer Swing Feature/Final table dealer pools (ADR 012) — CONFIG-UI flag.
   * When true: the table-mode badges, the config dialog, and the "Đội dealer tâm điểm"
   * right-rail box render and read live data via get_table_dealer_rules (Patch 6 wired the
   * real RPCs — no longer a mock). This flag ONLY reveals the config UI; it is NOT the
   * enforcement gate. Enforcement (the seat trigger + picker pool-filter blocking a non-pool
   * dealer on a feature/final table) is a SEPARATE kill-switch,
   * app_settings('dealer_feature_tables_enabled'), which stays OFF until owner-flipped
   * post-UAT → so configuring a pool here is INERT (saved, not yet protecting; the UI shows
   * an "enforcement OFF" banner). Reads are authz'd by get_table_dealer_rules
   * (is_club_dealer_control OR super_admin); the box is also role-gated in DealerSwingTab.
   */
  dealerFeatureTables: true,
  /**
   * Dealer self-salary screen — "Lương của tôi" in the dealer app (/dealer/salary),
   * READ-ONLY. FT shows the saved monthly payslip (full breakdown); PT shows a live
   * accruing balance + payment history. Dealers never pay themselves (the club pays
   * + resets). Default **OFF** (dark): while false the bottom-nav "Lương" tab is
   * hidden. Salary-A ships only a MOCK preview screen (no DB/RPC); the real per-dealer
   * data (get_my_dealer_payroll / get_my_pt_wage) + the PT wage ledger are wired in
   * Salary-D AFTER the B1 backend is applied live + types regenerated. Flip to true
   * ONLY after that. The /dealer/salary route is ALSO flag-gated — it redirects to
   * /dealer when off (not just nav-hidden), so direct navigation can't reach it.
   */
  dealerSelfSalary: true,
  /**
   * Scheduled pool entry for dealer self check-in (app + Telegram). UI-only mirror
   * of the server flag `dealer_selfcheckin_config.scheduled_pool_enabled`. When ON,
   * the dealer app shows the pool-entry note ("đã có mặt · vào pool lúc HH:MM" while
   * early, "đang trong pool" once the scheduled start is reached) and the check-in
   * toast reflects pending vs entered. **ON** (2026-06-16, Phase C): migration
   * `20260915000000` is applied live, the telegram-bot is redeployed, and the server
   * flag `dealer_selfcheckin_config.scheduled_pool_enabled` is set true. This flag is
   * UI-only — the rule is enforced server-side regardless of it; it just shows the
   * pool note. Kill-switch: the authoritative off-switch is the SERVER flag
   * (`UPDATE dealer_selfcheckin_config SET scheduled_pool_enabled=false`); set this
   * false too to also hide the UI note. See plan: dealer self check-in → scheduled
   * pool entry.
   */
  dealerPoolBridge: true,
  /**
   * Dealer Swing "Đóng tour" — Archive & Close Tour. Floor closes a whole tour:
   * the server archives the full swing snapshot (tour, tables, assignments,
   * break pool, reserved, audit) into `dealer_swing_archives` and ONLY THEN, in
   * the same transaction, releases every tour table + sends its dealers to the
   * break pool (on_break) — via the SECURITY DEFINER RPC
   * `archive_and_close_dealer_tour` (PR2 source-only, owner-gated apply).
   * The confirm dialog requires typing "DONG TOUR". **ON** (2026-06-15): the
   * migration `20260902000000_dealer_swing_close_tour.sql` (RPC + archive table)
   * is APPLIED LIVE + verified in a controlled session, and the owner chose a
   * GLOBAL launch — so all dealer-control staff see "Đóng tour". The RPC is
   * still permission-gated (each closes only their own club's tours) + idempotent
   * + archives before any release. Kill-switch: set false to hide the button.
   */
  dealerSwingCloseTourArchive: true,
  /**
   * P4b-2 Insurance Participation Layer admin UI at /club/admin/insurance — manage each
   * dealer's insurance_mode (NONE/STATUTORY/SERIES_ONLY), region, salary base + include
   * flags; read the region rate table. Default **OFF** (dark). While false the route and
   * the ClubAdmin entry card are hidden. Flip to true ONLY after the P4b Phase 1 tables
   * (`dealer_insurance_profiles`, `insurance_policy_rates`, migration 20260910000000) are
   * applied live. Until then the screen shows a "chưa áp dụng" notice and Save is disabled.
   * Read/write only the two config tables — NEVER touches calculate_dealer_payroll.
   */
  insuranceProfiles: false,
  /**
   * Floor Table Ops (Phase A1 + A2) — "Mở bàn" (open/reopen table), "Thêm người"
   * (pure seat placement, NO money), "Đóng bàn" (broken-table redraw → fill empty
   * seats, shortest-table-first), and "Bốc lại" (scheduled/tournament redraw:
   * final_table / table_count_threshold / itm / manual_custom, preview→confirm) on
   * the floor table-detail sheet / map. **ON for combined A1+A2 UAT.** All four RPCs
   * are applied live & verified in controlled DB sessions: `open_tournament_table`
   * 20260912000000, `floor_assign_player_to_seat` 20260913000000,
   * `close_tournament_table` 20260914000000, `redraw_tournament` 20260918000000
   * (SECURITY DEFINER, search_path=public, authenticated-only). Floor seat moves
   * only — never touches cashier money flow, payroll, or dealer swing. Rollback:
   * set back to false → redeploy (RPCs stay live but inert without this UI).
   */
  floorTableOps: true,
  /**
   * Club "Lịch series" — a per-club gallery of MANY series-schedule images (posters +
   * match schedules) shown as a swipeable carousel on the public ClubDetail page and
   * managed by admins in Media Center (MediaClubSchedules), alongside the single
   * daily/weekly schedule images. Default **OFF**: needs the source-only
   * `club_series_images` table (20261022000000) applied live first. While false the
   * admin upload section and the ClubDetail carousel do not render / never query the
   * missing table. Flip to true ONLY after the table is applied in a controlled DB session.
   */
  clubSeriesSchedule: true,
  /**
   * Multi-day tournaments ("Main Event" + flights + final day). Default **OFF**:
   * needs the source-only `tournament_events` table + `tournaments.event_id/phase/
   * flight_label` columns (20261024000000) applied live first, then the atomic
   * create RPC (MD-1B). While false: the "Multi-day" create option is hidden and
   * NOTHING queries `tournament_events` or the new columns (no select, no group-by
   * event_id) — so a not-yet-applied schema can never break the page. Flip to true
   * ONLY after the schema + create RPC are applied live in a controlled DB session.
   */
  multiDayTournaments: true,
  /**
   * New neon-green broadcast Tournament Clock (PR Clock-B). When true, every screen that
   * composes TvClockScreen (/tv/:id, /display/:token clock layout, ?mock=1) renders the new
   * VinPokerTournamentClock fed by mapTvDataToClock instead of the legacy Tv* layout. Default
   * **ON** (Clock-C, owner-enabled after UAT): live TV/tournament clocks now render the
   * neon-green VinPokerTournamentClock. Presentational-only swap: no DB writes, reads are
   * additive (starting_stack/guarantee_amount/buy_in/rake_amount/cover_url in the TV select).
   * Kill-switch: set false to instantly restore the legacy Tv* layout.
   */
  tournamentClockV2: true,
  /**
   * Per-tournament SERVICE FEE (phí dịch vụ) — a SECOND configured per-entry charge, separate from
   * rake. Player price = buy_in + rake_amount + service_fee_amount. Default **OFF** (dark). While
   * false: the ClubAdmin tournament create/edit "Phí dịch vụ" input is hidden, the cashier offline/
   * re-entry fee default stays = rake only, and the Owner Finance "Phí dịch vụ" line is suppressed.
   * Flip to true ONLY after BOTH owner-gated migrations are applied live: `20260915000000`
   * (tournaments.service_fee_amount column) AND `20260916000000` (get_club_finance_summary v3 with the
   * serviceFee stream), and the tournament-register edge fn is redeployed. The column defaults to 0, so
   * every existing tour is unaffected until an owner sets a service fee > 0.
   * **ON** (2026-06-17): both migrations applied live + golden-diff verified (output identical
   * except serviceFee=0), edge fn deployed. Kill-switch: set false to hide the UI again.
   */
  tournamentServiceFee: true,
  /**
   * Club Admin → Series Intelligence demo entry at /club/admin/series-intelligence.
   * Frontend-only owner-facing SHELL that explains the Club Intelligence flow
   * (CSV → Data Readiness → Tournament Economics Mini Audit → Series Workflow),
   * the required CSV columns and the safety boundary. No engine, no data, no
   * backend, no DB/RPC/Edge. Default **OFF** (dark): while false the ClubAdmin
   * entry card is hidden; the route still renders for club admins/owners who open
   * it directly (preview) and shows a small "internal demo" note. Flip to true to
   * surface the card for the series-owner demo.
   */
  clubSeriesIntelligence: true,
  /**
   * Series Intelligence — CSV import (test / what-if data). When ON, the collapsed "CSV thủ công"
   * section becomes a real importer: download a template, upload a CSV, and the dashboard renders
   * the parsed events (source: 'csv') with a "dữ liệu test" banner. Browser-only and READ-ONLY —
   * nothing is written to the DB; the data lives in the page session and clears on "Về dữ liệu live".
   * When OFF, the legacy static placeholder (disabled CTA) shows instead.
   */
  seriesIntelligenceCsvImport: true,
  /**
   * Series Intelligence — Forward-layer Monte Carlo EV/Risk (PATCH 3). When ON, the page shows a
   * MonteCarloPanel: pick a festival's events from the reference distribution, assume ρ/α/cost/bankroll,
   * and see a SCENARIO / what-if (EV distribution, P(loss), Risk-of-Ruin, P(overlay)) — explicitly NOT a
   * forecast. Pure client-side; reads only the loaded historical CSVs (never live DB/registrations); no
   * Supabase/RPC/Edge/migration. Also gates the ScheduleGeneratorPanel (PATCH B) + its EV-feed (B.2).
   * **ON (owner UAT, 2026-06-21):** flipped at the owner's request to surface the forward-layer panels for
   * review. Still client-only / read-only / no DB — kill-switch: set false to hide again.
   */
  forwardLayerMonteCarlo: true,
  /**
   * Series Intelligence — CAPTURE v0 Decision Log admin. When ON, the route
   * `/club/admin/series-decision-log` shows a club-owner skeleton to read + manually log decisions into
   * `series_decision_logs` (recommended vs decision vs public action). DATA CAPTURE ONLY — no model, no
   * prediction. Requires the source-only migration `20261125000000_series_capture_v0.sql` to be applied
   * live first (the 4 capture tables); until then the writes have no target. Default **OFF** (dark): the
   * route redirects home when off. Kill-switch: set false to hide the admin skeleton.
   */
  seriesDecisionLog: true,
  /**
   * Series Intelligence — turnout forecast (transparent ridge log-linear, RESEARCH tier). When ON, step ④
   * of the SI page shows the TurnoutForecastPanel: predicts entries for an upcoming event from the club's
   * OWN past events with a confidence band + tier + walk-forward CV error vs a median baseline. Labeled
   * Hypothesis ("dự báo thống kê — chưa backtest đủ") — NEVER "Model Estimate". Pure client-side, leakage
   * discipline locked (actuals are targets only). Default **OFF** (dark). Flip conditions: ≥12 events with
   * entries + walk-forward CV beats the baseline + owner sign-off. Kill-switch: set false to hide.
   */
  seriesTurnoutForecast: true,
  /**
   * Series Intelligence — regime caveat (lớp chế độ, static). When ON, every forward-looking number
   * (scenario outlook, Monte Carlo overlay, festival EV, turnout forecast) carries a one-line caveat:
   * "Giả định: chế độ thị trường/pháp lý hiện tại còn giữ…". Text-only honesty layer per the framework's
   * regime principle — no state, no interactivity (the local-only owner switch is a SEPARATE deferred
   * increment). Default **OFF** (dark); kill-switch: set false to hide the caveat lines.
   */
  seriesRegimeNotice: true,
  /**
   * Series Intelligence — "Biên đóng góp theo loại giải" (contribution margin by event type). When ON,
   * the Owner Command Center shows per-type rows: fee revenue kept − observed GTD overlay cost (only for
   * events WITH a GTD; missing-GTD events are counted + noted, never guessed). Explicitly NOT full
   * profit: subtitle states it excludes staff/marketing/operations. Buy-in is never treated as revenue.
   * Pure client-side descriptive math (Observed Pattern). Default **OFF** (dark); kill-switch: false.
   */
  seriesMarginByType: true,
  /**
   * Series Intelligence — fractional-Kelly GTD commitment hint (quant spec §3.5, OPTIONAL/deferred).
   * When ON, the festival EV panel shows a one-line "Gợi ý tham khảo theo Kelly phân đoạn (¼–½)" that
   * requires the owner to ENTER a bankroll (never inferred from data); σ approximated from P5–P95 and
   * stated as such; Hypothesis-labeled, not financial advice. Default **OFF**; build only after PR0–6
   * UAT passes and the owner explicitly asks. Kill-switch: set false to hide.
   */
  seriesKellyHint: false,
  /**
   * Series Intelligence — LOCAL-ONLY "regime changed" switch (PR5b). When ON, the Command Center shows
   * a RegimeSwitch letting the owner mark the market/legal regime as CHANGED, which escalates every
   * RegimeNotice caveat to an active warning. Stored in localStorage on THIS browser only — it is NOT a
   * club setting (other people/devices/agents don't see it); the switch copy states this. Rides on
   * `seriesRegimeNotice` (self-hides when that is off). The DB-backed official flag (audit of who
   * flipped it) is a separate owner-gated increment. Default **OFF**; kill-switch: set false.
   */
  seriesRegimeSwitch: false,
  /**
   * Series Intelligence — G7 forecast calibration card in the ⑥ CAPTURE console. When ON, it scores past
   * forecast snapshots against real actuals (client-side, reads the existing capture tables — NO new DB)
   * and reports in-band rate vs the 90% target + systematic bias. Under-powered by design: below 10
   * scored forecast↔actual pairs it shows a "chưa đủ dữ liệu (X/10)" state and makes no calibration
   * claim. Measured facts only (Observed Pattern). Default **OFF** until real pairs accrue; kill-switch: false.
   */
  seriesCalibration: false,
  /**
   * GTD #2 — server-authoritative TRUE prize pool / overlay. When ON, the GTD overlay card
   * reads `get_tournament_prize_pool` (SUM of confirmed buy_in) and shows the real "thực thu"
   * overlay for events with confirmed entries, falling back to the #415 "ước tính" estimate
   * otherwise. Default **OFF** (dark) — the RPC is source-only/not applied yet; flip to true
   * only AFTER the controlled apply of 20261011000000.
   *
   * ON (2026-06-20): RPC applied live + verified (security/grants/owner-scope) and the 3 pre-flip
   * gates passed (refund/void edge · cross-tenant isolation · reconcile). See get_tournament_prize_pool.
   */
  gtdTruePrizePool: true,
  /**
   * Payroll per-dealer MANUAL BHXH + tax override. Adds two optional inputs to the dealer
   * edit/create dialogs ("BHXH thủ công" + "Thuế TNCN thủ công"): để trống = tự động tính,
   * nhập 0 = không thu, nhập số = dùng số đó. Default **OFF** (dark) because it needs the two
   * owner-gated migrations applied live first: `20261001000000` (dealers.manual_bhxh_vnd /
   * manual_tax_vnd columns) AND `20261001000001` (calculate_dealer_payroll override body,
   * golden-diff verified no-op when NULL). While false the inputs are hidden and the
   * dialogs never write the (absent) columns. Flip to true ONLY after both are applied +
   * types regenerated. The formula treats NULL as auto-compute, so applying the migrations
   * alone changes ZERO payroll numbers until the owner actually sets an override.
   * **ON** (2026-06-19): both migrations applied live + golden-diff verified (net byte-identical
   * for all 39 active dealers; overrides NULL = no-op). The dealer edit/create dialogs now show
   * the "Khấu trừ thủ công" inputs. Kill-switch: set false to hide them again.
   */
  manualPayrollDeductions: true,
  /**
   * Salary v2 — operator dealer-salary tab split into two sub-tabs: "Theo tháng · Full-time"
   * (the existing monthly payroll + payment lifecycle, reused unchanged) and "Theo giờ ·
   * Part-time" (live accruing wage balance + full-payment-then-reset). Default **OFF** (dark):
   * the PT sub-tab calls the Salary-B1 RPCs (get_club_pt_wages / pay_part_time_balance) which
   * are merged as source but NOT applied live yet, so while false the parent renders the legacy
   * DealerPayrollTab directly (byte-identical) and the V2 wrapper never mounts. Flip to true ONLY
   * after the B1 migrations (20261028000000/01) are applied live + types regenerated.
   */
  salaryTabV2: false,
  /**
   * Chip Ops — read-only Issued-Chip-Inventory screen (/chip-ops) + the Chip-Master role.
   * The screen shows server-computed per-denomination chip counts + a reconciliation badge for
   * a tournament (RPC `get_issued_chip_inventory`); strictly read-only. Default **OFF** (dark):
   * both the chip_ops_* foundation (migration 20261015000000) and the club_chip_masters role
   * (20261016000000) are source-only / NOT applied live yet. While false: the ClubAdmin entry
   * card is hidden, the /chip-ops route redirects, AND `useAuth` never queries
   * club_chip_masters (so it cannot 42P01 before the table exists — see lib/chipMaster.ts).
   * Flip to true ONLY after BOTH migrations are applied in a controlled DB session + types
   * regenerated. The panel degrades gracefully if the RPC is still absent.
   * **ON** (2026-06-22): the 1a foundation (`20261015000000`) is applied live, so the
   * owner-scoped inventory RPC works. Apply `20261016000000` (Chip-Master role) too to
   * enable delegation + stop the guarded club_chip_masters lookup from 404-ing.
   */
  chipOps: true,
  /**
   * Remote Poker IQ questions — lets the live drill (/poker-iq) merge questions a
   * Super Admin authored in the admin panel (Poker IQ → Câu hỏi, stored in the
   * `app_settings` key `poker_iq_questions`) on top of the built-in static hand
   * bank. Only `approved` authored questions are ever merged, and every hand is
   * shape-guarded (≥2 options + a valid preferredBaseline) before use, so a
   * corrupt bank can never break the drill. Default **OFF** (dark): while false the
   * drill plays the built-in static bank EXACTLY as today (zero extra reads, no
   * behaviour change) — the authoring panel still works so the owner can build &
   * review the bank first. Flip to true to start serving the authored questions to
   * players. Frontend-only — no DB/RPC/Edge/migration (app_settings already exists
   * with public-read / super_admin-write RLS). Kill-switch: set false.
   */
  pokerIqRemoteQuestions: false,
  /**
   * Marketing module — the club-scoped `marketing` role + the /marketing surface (compose →
   * schedule → auto-dispatch to channels) + the `marketing-dispatch` Edge cron. Default **OFF**
   * (dark): it needs the source-only migrations applied live first (`20261101000000` enum,
   * `20261101000001` role, `20261101000002` core schema/RPCs, `20261101000003` dispatch cron).
   * While false:
   *   - the /marketing route redirects and the nav entry is hidden;
   *   - `useAuth` NEVER queries `club_marketers` (see lib/marketer.ts) so it cannot 42P01 before
   *     the table exists;
   *   - the dispatch Edge fn / cron simply have no due posts (or are not yet scheduled).
   * Flip to true ONLY after the four migrations are applied in a controlled DB session, the
   * `marketing-dispatch` Edge fn is deployed, and owner UAT passes on a preview branch.
   * P0 scope is **Telegram-only** — Facebook/Zalo channels stay disabled in the composer until a
   * real per-club integration exists. Kill-switch: set false to hide the whole module again.
   *
   * **ON** (2026-06-24, owner-authorized go-live): the four migrations were applied live + the
   * marketing-dispatch Edge fn deployed + cron scheduled via the marketing-apply workflow (run
   * 28097001780, all steps green incl. dry-invoke=no_posts). Tab now visible in VẬN HÀNH for
   * marketers / club owners / admins. Kill-switch: set false to hide the module again.
   */
  marketingModule: true,
  /**
   * Marketing approval gate. Default **OFF** because the owner chose direct-publish: a marketer
   * can schedule their own posts without a separate approver (a compliance hard-block still runs
   * at schedule time — see `marketing_schedule_post`). Flip to true later to require club-owner
   * approval before a post can be scheduled (the `approved_by`/`approved_at` columns already
   * exist for this). UI-only intent today; the server enforces direct-publish until the approval
   * RPCs are added in a later phase.
   */
  marketingRequireApproval: false,
  /**
   * F&B (Food & Beverage) module — pre-paid food/drink sales + mandatory inventory & COGS.
   * `fnbModule` is the MASTER switch; it ALSO gates the useAuth `club_fnb_staff` lookup (see
   * lib/fnbStaff.ts) so it can never 42P01 before that table exists live. The sub-flags gate each
   * surface: `fnbCounter` (quầy + table ordering), `fnbKitchen` (live Kitchen Display),
   * `fnbInventory` (ingredients/recipes/stock-in/stocktake admin tabs), `fnbFinance` (the F&B line
   * in the Owner Finance dashboard — additionally needs the per-club fnb_settings.fnb_in_club_net).
   * ALL default **OFF** (dark): the source-only migrations 20261111000000..07 are NOT applied live
   * yet, so every F&B page redirects / shows a placeholder and nothing queries the absent fnb_*
   * tables. Flip each ONLY after the matching backend is applied in a controlled DB session + UAT.
   */
  fnbModule: true,
  fnbCounter: true,
  fnbKitchen: true,
  fnbInventory: true,
  fnbFinance: true,
  /**
   * F&B A1 — COMP (đồ miễn phí): cashier/owner authorises a free order (subtotal=0, stock still
   * decrements, COGS snapshotted). Migrations 20261111000012 (schema + fnb_create_comp_order) AND
   * 20261111000013 (comp split in finance/report) applied live 2026-07-02; owner golden-diffed the
   * Owner Finance Dashboard before/after — numbers matched. LIVE.
   */
  fnbComp: true,
  /**
   * F&B A2 — link a regular counter order to a REAL table (game_tables) and/or a seated player
   * (tournament_seats.player_id) for "F&B theo bàn / theo player" reporting — knowing/reporting ONLY,
   * never a player tab/balance/debt. Gates the table/player pickers on the counter AND the new F&B
   * report view. Requires migration 20261111000014 (table_ref/player_ref cols + fnb_create_order 9-arg
   * + fnb_list_link_targets read RPC + fnb_get_report byTable/byPlayer) applied live first.
   * Migration 20261111000014 applied live 2026-07-02 (owner controlled-apply; pronargs=9 verified).
   * ON.
   */
  fnbTableLink: true,
  /**
   * F&B A3 — per-shift cash reconciliation (chốt ca): the counter cashier opens a cash shift, takes
   * F&B orders during it, then closes it by counting the drawer and seeing the variance (khớp/thiếu/
   * thừa) vs the system-expected cash. Time-window design — a shift owns every order whose paid_at
   * falls in [opened_at, closed_at]; the live money RPCs (fnb_mark_paid / fnb_create_order /
   * fnb_create_comp_order) are NOT touched. Requires migrations 20261111000015 (fnb_cashier_shifts) +
   * 20261111000016 (open/close/report RPCs) applied live first. Gates the "Chốt ca" tab on the
   * counter. Migrations 20261111000015/16 applied live 2026-07-02 (owner controlled-apply, PASS).
   * ON after preview UAT.
   */
  fnbShifts: true,
  /**
   * F&B GUEST QR ORDERING (khách quét QR gọi món) — one QR sticker per table opens the chrome-less
   * /fnb/order?t=<token> page: guest confirms "Bạn đang ngồi tại Bàn X", picks a seat, orders from
   * the club menu, then pays by VietQR bank transfer (SePay auto-confirm) or cash (a server collects
   * at the table via /fnb/serve). Gates the guest page, the /fnb/serve server surface, and the
   * FnbAdmin "QR bàn" tab. Requires migrations 20261111000017/18/19 + 20261211000000 applied live
   * AND the per-club fnb_settings.guest_order_enabled switch. Default OFF (dark). Flip after the
   * migrations are applied + preview UAT (see plan PART 11).
   */
  fnbGuestOrder: false,
  /**
   * F&B PUBLIC DEMO (/fnb/demo) — a SELF-CONTAINED static showcase for showing the F&B vision to a
   * guest. The page imports NO supabase client and calls NO RPC (every button is a no-op toast), so
   * it can never read or mutate real data. Intentionally **ON** so the "F&B (Xem thử)" item shows in
   * the VẬN HÀNH menu for owners/admins. Kill-switch: set false to hide the demo entirely. The real
   * F&B module (orders / inventory / finance) is NOT on production — it lives on the agent/fnb-module
   * branch behind its own flags and is unaffected by this demo.
   */
  fnbDemo: true,
  /**
   * Payout "Engine 3-neo" — server-authoritative tournament payout curve (auto N / min-cash floor /
   * smooth top-heavy-or-flat distribution / tiers / exact pool preservation), replacing the
   * manual-rows Prizes panel. This is the GLOBAL master switch; the actual per-club rollout is
   * narrowed by `payoutEngineClubs` / `payoutEngineAllClubs` via `isPayoutEngineEnabledForClub`.
   * **ON (staged) 2026-06-29** after backend (PR-2a) + Edge (PR-2b) went live, the per-club gate
   * (#594) merged, and a full live UI write drill (Drill A) passed — but allow-listed to ONE club
   * only (Hanoi Royal Poker `22222222`); every other club keeps the old manual panel UNCHANGED.
   * Official payouts are only ever written by the close-registration snapshot→apply flow — never
   * recomputed live. Kill-switch: set false (or empty the allowlist) → instant revert to the old
   * panel for every club.
   */
  payoutEngine: true,
  /**
   * Per-club allowlist for the Engine-3-neo payout panel (STAGED ROLLOUT). Only consulted
   * when `payoutEngine` is true. Add a club's UUID here to enable the new PayoutEnginePanel
   * for THAT club only — every other club keeps the old PrizeStructurePanel. Empty = no club
   * (safe default). Resolved by `isPayoutEngineEnabledForClub` below.
   */
  payoutEngineClubs: ['22222222-2222-2222-2222-222222222222'] as string[], // Hanoi Royal Poker — first club live
  /**
   * Wide-rollout switch for the payout panel: when true (and `payoutEngine` is true) EVERY
   * club gets the engine panel without listing each id. Keep false during staged rollout.
   */
  payoutEngineAllClubs: true,
  /**
   * Native CUSTOM payout mode (PR-C) — adds a `CUSTOM — CLB tự cấu hình` style to the payout panel
   * where the club dictates the exact split as percentages (server stores basis points, Σ=10000).
   * Default **OFF** (kill-switch). Only meaningful where `payoutEngine` is already enabled for the
   * club. Flip true ONLY after the CUSTOM migration (20261123000000) is applied live and the
   * compute-payouts Edge with the CUSTOM path is deployed; while false the CUSTOM option is hidden
   * and the backend CUSTOM path is never invoked.
   */
  payoutCustomMode: true,
  /**
   * CUSTOM payout extras (import an Excel/CSV payout sheet · save & reload the club's own CUSTOM
   * structures as named templates). Default **OFF** (kill-switch). Only meaningful where
   * `payoutCustomMode` is already on. Flip true ONLY after the templates migration
   * (20261126000000) is applied live; while false the import/save UI is hidden and
   * payout_templates is never read/written for CUSTOM.
   */
  payoutCustomTemplates: true,
  /**
   * Planned payout settings (PR-4) — pre-fills the payout generator (kiểu giải/ITM%/min-cash/
   * làm tròn) from `tournaments.planned_*` (columns already live since 20261120000000, previously
   * unused) and adds a "Lưu mặc định cho giải này" button that writes them back. Uses the
   * EXISTING `tournaments` UPDATE RLS (`is_club_dealer_control` — club owner or TD/floor-control) —
   * no new RPC or migration. **ON** (2026-07-02, owner-approved): no DB dependency to wait on
   * (existing columns/RLS only), so it went live directly. Kill-switch: set false to restore the
   * old behavior (hardcoded DAILY/15%/2×/rounding-by-buy-in defaults, no save button).
   */
  payoutPlannedSettings: true,
  /**
   * TV payout board — two-tier display (PR-5). Collapses a LIVE_STANDARD run's equal-amount
   * bands (e.g. ranks 10-12) into one "10–12" row instead of 3 duplicate rows, and raises the
   * shown-rows cap (grouped, so a 19-ITM LIVE_STANDARD run now fits without truncation). Pure
   * client-side render change over the SAME `tournament_prizes` data the TV already reads — no
   * new fetch/RPC/migration. **ON** (2026-07-02, owner-approved): pure client render, no DB
   * dependency. Kill-switch: set false to restore `TvPayoutsScreen`'s old behavior (first 12
   * ranks, one row per rank, no band grouping).
   */
  tvPayoutBandedDisplay: true,
  /**
   * Player History (Phase 1 — data foundation). When ON, the cashier offline buy-in form shows an
   * optional "Số điện thoại" field with a member lookup, so walk-ins are anchored to ONE per-club
   * `club_members` row and their entries/results accumulate. The real server-side switch is the
   * per-club `club_settings.player_history_enabled` flag: with that false, the linking trigger +
   * offline RPC do nothing and no member rows are created, so the DB stays fully inert per club.
   * **ON** (2026-07-02, owner-approved): all three migrations (20261208/09/10) applied live +
   * verified (indexes, grants, triggers, single 6-arg offline RPC — no PostgREST overload) and
   * `player_history_enabled=true` set for all 4 clubs. Kill-switch: set false to instantly hide the
   * cashier phone field again (server-side objects stay, just unused by the UI).
   */
  playerHistory: true,
  /**
   * Close Report (Chốt giải) — operator tournament settlement + finalize on the Floor. When ON, a
   * live/final_table tournament shows a "Chốt giải" report: entries by source, money-IN (buy-in
   * pass-through + rake + service fee) vs money-OUT (prize by place + cashout), the club-revenue
   * (= rake + service) and cashier-drawer reconciliation, read-only staking/dealer link status, and
   * a 2-step "Chốt giải" lock (Owner/Cashier only). Locking calls the source-only `close_tournament`
   * RPC (idempotent, audited via tournament_state_transitions, snapshots into tournament_close_report)
   * and does NOT auto-fire staking release or the dealer "Đóng tour" — those stay explicit so it can
   * never double-fire the existing auto-finalize paths. Money doctrine: buy-in and prize are
   * PASS-THROUGH (never club revenue); the report recomputes NOTHING that is already a saved value
   * (payroll, ledger). Default **OFF** (dark): while false the report/button never render and nothing
   * queries the source-only `close_tournament` RPC or `tournament_close_report` table, so an
   * un-applied schema can't break the Floor. Flip to true ONLY after the enum-unify +
   * tournament_close_report + close_tournament migration is applied live in a controlled DB session
   * and owner UAT passes. Kill-switch: set false.
   *
   * **ON** (2026-07-03, owner UAT): migration `20261213000000` applied live (tournament_close_report
   * + close_tournament RPC + enum value 'completed' added first); flipped ON so Owner/Cashier can UAT
   * on a TEST tournament. Kill-switch: set false to hide the "Chốt giải" button instantly.
   */
  closeReport: true,
  /**
   * Floor "Loại" out-confirm dialog. When ON, tapping "Loại" on the floor table map opens a
   * plain, guided confirm dialog that previews the player's finishing place + prize money
   * ("[Tên] về hạng [N] — [tiền]") BEFORE the (unchanged) bust runs. Non-ITM outs show the
   * place only ("ngoài cơ cấu giải"), never a fake prize. Frontend-only: it reads the already
   * live `tournament_prizes` (get_tournament_prizes) read-only and computes place from the
   * live active-seat count the panel already loads — it changes NO write path (the bust is the
   * same `update_seats is_active=false` call; the server auto-records the official result via
   * the player-history chain exactly as before). Default **OFF** (per flag policy): while false
   * the "Loại" button busts immediately, byte-identical to today. Flip to true (one line) after
   * owner UAT to surface the confirm step — a low-risk safety improvement. Kill-switch: set false.
   * **ON** (2026-07-03, owner-approved): frontend-only, reads already-live tournament_prizes; the bust
   * write-path is unchanged. Kill-switch: set false to bust immediately again (byte-identical to before).
   */
  floorOutConfirm: true,
  /**
   * mobileOpsV2 — iPhone-first operator shell under `/ops/*` (SafeAreaPageShell + 5-tab bottom nav:
   * Hôm nay / Giải đấu / Bàn / Cảnh báo / Thêm). Prototype = màn "Floor hôm nay" với DỮ LIỆU MẪU,
   * read-only, KHÔNG thao tác tiền. Frontend-only: không DB/RPC/Edge/migration; không đụng `Layout.tsx`
   * hay `/dealer/*`. Default **OFF** (per flag policy): while false the `/ops/*` routes show a "chưa bật"
   * notice (except admin/owner preview) and nothing mounts → prod unchanged. Flip to true ONLY after owner
   * UAT on a preview branch. Spec: docs/design/ios-floor-ux-spec.md + ios-operations-implementation-plan.md.
   */
  mobileOpsV2: false,
} as const;

/**
 * Per-club gate for the Engine-3-neo PayoutEnginePanel. `FEATURES.payoutEngine` stays the
 * GLOBAL master switch; this narrows it per club so the new panel can go live for ONE club
 * first while every other club keeps the old PrizeStructurePanel. Resolution order:
 *   1. master `payoutEngine` off → never on (whatever the allowlist says);
 *   2. `payoutEngineAllClubs` true → every club (wide rollout);
 *   3. otherwise → only club ids present in `payoutEngineClubs`.
 * No clubId (or not allow-listed) → false → caller renders the old manual panel. The
 * `features` arg is injectable for tests; production callers pass just the clubId.
 */
export function isPayoutEngineEnabledForClub(
  clubId?: string | null,
  features: {
    payoutEngine: boolean;
    payoutEngineAllClubs: boolean;
    payoutEngineClubs: readonly string[];
  } = FEATURES,
): boolean {
  if (!features.payoutEngine) return false;
  if (features.payoutEngineAllClubs) return true;
  if (!clubId) return false;
  return features.payoutEngineClubs.includes(clubId);
}
