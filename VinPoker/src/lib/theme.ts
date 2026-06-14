// Lightweight, additive theme switcher.
// Default ("default") keeps VinPoker's existing dark theme untouched.
// "claude-warm" applies the optional ivory/terracotta editorial theme via the
// [data-theme="claude-warm"] CSS block in index.css.
//
// Persistence mirrors the i18n pattern (localStorage key "vinpoker.lang") so the
// choice survives reloads. The same key is read by the early-apply inline script
// in index.html to avoid a theme flash before React mounts.

export type AppTheme = "default" | "claude-warm";

export const THEME_KEY = "vinpoker.theme";

export const THEMES: { value: AppTheme; labelVi: string; labelEn: string }[] = [
  { value: "default", labelVi: "Mặc định (Tối)", labelEn: "Default (Dark)" },
  { value: "claude-warm", labelVi: "Claude Warm (Sáng)", labelEn: "Claude Warm (Light)" },
];

export function getStoredTheme(): AppTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "claude-warm") return v;
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall back to default */
  }
  return "default";
}

export function applyTheme(theme: AppTheme): void {
  const el = document.documentElement;
  if (theme === "claude-warm") {
    el.setAttribute("data-theme", "claude-warm");
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
