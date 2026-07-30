export function projectRefFromSupabaseUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const projectRef = hostname.split(".")[0]?.trim();
    if (!projectRef) throw new Error("missing project ref");
    return projectRef.replace(/[^a-zA-Z0-9_-]/g, "-");
  } catch {
    return "local";
  }
}
export function opsAuthStorageKey(url: string): string {
  return `sb-${projectRefFromSupabaseUrl(url)}-ops-auth-token`;
}
