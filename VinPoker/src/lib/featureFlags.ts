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
  /** Realtime queue updates — requires tournament_registrations in the realtime publication. */
  registrationRealtime: false,
} as const;
