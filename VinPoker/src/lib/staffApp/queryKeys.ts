export const staffKeys = {
  all: ["staffApp"] as const,
  link: (uid?: string) => [...staffKeys.all, "link", uid ?? "anon"] as const,
  attendance: (staffId?: string) => [...staffKeys.all, "attendance", staffId ?? ""] as const,
  salary: (staffId?: string) => [...staffKeys.all, "salary", staffId ?? ""] as const,
};

