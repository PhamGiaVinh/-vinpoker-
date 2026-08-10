const OPS_PATH_PATTERN = /^\/ops(?:\/|$)/u;

export function safeOpsDocumentTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  const parsed = new URL(value, "https://vinpoker.invalid");
  if (!OPS_PATH_PATTERN.test(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function playerLoginUrlForOpsTarget(target: string | null): string {
  return `/auth?next=${encodeURIComponent(target ?? "/ops")}`;
}
