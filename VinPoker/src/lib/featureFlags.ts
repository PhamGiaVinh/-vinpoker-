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
   * Move-player dialog + System-A row locking in TableDrawPanel.
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
   * Remote TD AI: lets the assistant call the `td-ai-assistant` Edge Function
   * (Gemini via Lovable). Default **OFF** — the kill switch. While false,
   * `useTdAi` NEVER calls the Edge Function / network: it answers purely from
   * the local keyword corpus (labelled DEMO, advisory-only). Flip to true ONLY
   * after the function is deployed AND the owner enables PR E. Off keeps prod
   * safe even though the PR E code is present on main but undeployed.
   */
  tdAiRemote: false,
  /**
   * Online Poker (play-money, closed alpha) UI under /poker/*. Default **OFF** —
   * the dark switch for the GE-2D shell. While false, /poker and /poker/table/:id
   * render <PokerComingSoon/> (a "đang phát triển" notice); real users never see
   * the mock shell. Flip to true ONLY after: (a) the GE-2C runtime migration
   * 20260820000000 is applied live, (b) online_poker_config.enabled is true, and
   * (c) the client is wired to the online-poker-action Edge function. The shell's
   * own RUNTIME_LIVE constant (src/lib/onlinePoker/types.ts) is a second gate that
   * keeps action buttons disabled until the runtime is actually reachable.
   */
  onlinePoker: false,
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
} as const;
