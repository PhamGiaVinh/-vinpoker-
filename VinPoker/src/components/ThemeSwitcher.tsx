import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, getStoredTheme, type AppTheme } from "@/lib/theme";

interface Props {
  variant?: "compact" | "full";
}

// Single toggle button: tap to switch between the default dark theme and the
// optional "Claude Warm" theme. Default (dark) is preserved; the choice is
// persisted via lib/theme (localStorage "vinpoker.theme").
export const ThemeSwitcher = ({ variant = "compact" }: Props) => {
  const { i18n } = useTranslation();
  const isEn = (i18n.language || "").toLowerCase().startsWith("en");
  const [theme, setTheme] = useState<AppTheme>("default");

  // Read the persisted choice on mount (kept in sync with the early-apply
  // inline script in index.html).
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const isWarm = theme === "claude-warm";

  const toggle = () => {
    const next: AppTheme = isWarm ? "default" : "claude-warm";
    setTheme(next);
    applyTheme(next);
  };

  const label = isWarm
    ? (isEn ? "Theme: Claude Warm" : "Giao diện: Sáng")
    : (isEn ? "Theme: Dark" : "Giao diện: Tối");

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label={isEn ? "Toggle theme" : "Đổi giao diện"}
      title={isEn ? "Toggle theme" : "Đổi giao diện"}
      className={variant === "full" ? "w-full justify-start gap-2 h-10" : "gap-1.5 h-9"}
    >
      {isWarm ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
      <span className="text-xs">{label}</span>
    </Button>
  );
};
