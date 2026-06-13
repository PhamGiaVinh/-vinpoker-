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
} as const;
