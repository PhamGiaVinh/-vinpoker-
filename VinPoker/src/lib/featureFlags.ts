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
   * Online Poker (play-money, closed alpha) UI under /poker/*. **ON** (closed alpha
   * 2026-06-17): GE-2C runtime migrations applied live, edges deployed, crons active.
   * Precondition (b) online_poker_config.enabled is set true via a separate controlled
   * DB op before gameplay starts — while still false the backend returns "disabled" and
   * the lobby is visible but actions are rejected gracefully. The shell's own
   * RUNTIME_LIVE constant (src/lib/onlinePoker/types.ts) is a second gate that keeps
   * action buttons hot. Kill-switch: set false to restore <PokerComingSoon/> for all.
   */
  onlinePoker: true,
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
  blindEditorSave: false,
  /**
   * Reusable blind-structure templates ("thư viện cấu trúc blind"). Default **OFF**
   * because it needs both the `update_blind_structure` RPC (20260825000000) AND the
   * `blind_structure_templates` table (20260920000000) applied live first. While
   * false: no template UI renders ("Lưu thành mẫu" / "Tải mẫu" in the blind editor
   * and the "Cấu trúc blind" picker in Tạo giải are hidden) so nothing queries the
   * missing table. Flip to true ONLY after both objects are applied in a controlled
   * DB session (the editor full-replace path also requires blindEditorSave=true).
   */
  blindTemplates: false,
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
} as const;
