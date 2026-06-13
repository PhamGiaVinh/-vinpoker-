// Feature flags for staged rollout of cashier/floor features.
// Flipping a flag is a one-line commit — keep defaults SAFE (hidden) until the
// owner's production UAT passes (plan: Seat Floor Cashier UX, 2026-06-13).
export const FEATURES = {
  /**
   * Cashier "Đăng ký giải" tab (confirm online registration → seat → receipt).
   * While false the tab is hidden from regular cashiers; admins and club owners
   * still see it so the owner can UAT production before exposing it.
   */
  cashierRegistrations: false,
  /** Offline buy-in dialog — requires create_offline_registration RPC (NOT live). */
  offlineBuyIn: false,
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
} as const;
