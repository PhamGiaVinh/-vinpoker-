// Lightweight, additive theme switcher.
// Default ("default") keeps VinPoker's existing dark theme untouched.
// "vinpoker-warm" applies the optional deep-parchment/terracotta light theme via
// the [data-theme="vinpoker-warm"] CSS block in index.css.
//
// Persistence mirrors the i18n pattern (localStorage key "vinpoker.lang") so the
// choice survives reloads. The same key is read by the early-apply inline script
// in index.html to avoid a theme flash before React mounts.
//
// Backward-compat: the theme was previously stored as "claude-warm". Older saved
// values are accepted and normalized to "vinpoker-warm" so existing light-mode
// users keep their theme without a broken first paint.

export type AppTheme = "default" | "vinpoker-warm";

export const THEME_KEY = "vinpoker.theme";

export function getStoredTheme(): AppTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "vinpoker-warm") return v;
    if (v === "claude-warm") return "vinpoker-warm"; // legacy value migration
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall back to default */
  }
  return "default";
}

export function applyTheme(theme: AppTheme): void {
  const el = document.documentElement;
  if (theme === "vinpoker-warm") {
    el.setAttribute("data-theme", "vinpoker-warm");
  } else {
    // No attribute → :root (existing dark theme) applies. Default preserved.
    el.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore persistence failure */
  }
}
