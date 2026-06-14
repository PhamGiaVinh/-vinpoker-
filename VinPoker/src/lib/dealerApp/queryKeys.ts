// React Query key factory for the dealer app (mirrors useTournaments' pattern).

export const dealerKeys = {
  all: ["dealerApp"] as const,
  link: (uid?: string) => [...dealerKeys.all, "link", uid ?? "anon"] as const,
  today: (dealerId?: string, workDate?: string) =>
    [...dealerKeys.all, "today", dealerId ?? "", workDate ?? ""] as const,
  week: (dealerId?: string, weekStart?: string) =>
    [...dealerKeys.all, "week", dealerId ?? "", weekStart ?? ""] as const,
  notifications: (dealerId?: string) => [...dealerKeys.all, "notes", dealerId ?? ""] as const,
  careers: (uid?: string) => [...dealerKeys.all, "careers", uid ?? "anon"] as const,
  applications: (uid?: string) => [...dealerKeys.all, "applications", uid ?? "anon"] as const,
  trainingSessions: (uid?: string) => [...dealerKeys.all, "training", uid ?? "anon"] as const,
};
