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
   * Tracker Live Action Engine MVP — live per-action playback on the public
   * tournament viewer (/live/:id). While a hand is in_progress, the viewer
   * fast-polls so spectators see each recorded action in near-real-time
   * (`record_action` only writes `hand_actions`, which fires no
   * `tournament_hands` realtime event, so the default path updates only after
   * the hand is finalised). Default **OFF**: while false the viewer behaves
   * exactly as today (realtime + 30s polling fallback only). Frontend-only — no
   * DB/publication change; a later phase can swap the fast-poll for a
   * `hand_actions` realtime subscription (controlled publication op).
   */
  liveActionEngine: false,
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
} as const;
