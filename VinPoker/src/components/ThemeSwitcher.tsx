import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb, LightbulbOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, getStoredTheme, type AppTheme } from "@/lib/theme";

interface Props {
  variant?: "compact" | "full";
}

// Light-bulb toggle: tap to switch light (warm) ↔ dark mode.
// Default (dark) is preserved; the choice is persisted via lib/theme
// (localStorage "vinpoker.theme"). Bulb ON = light mode, bulb OFF = dark mode.
export const ThemeSwitcher = ({ variant = "compact" }: Props) => {
  const { i18n } = useTranslation();
  const isEn = (i18n.language || "").toLowerCase().startsWith("en");
  const [theme, setTheme] = useState<AppTheme>("default");

  // Read the persisted choice on mount (kept in sync with the early-apply
  // inline script in index.html).
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const isLight = theme === "claude-warm";

  const toggle = () => {
    const next: AppTheme = isLight ? "default" : "claude-warm";
    setTheme(next);
    applyTheme(next);
  };

  const tip = isEn
    ? (isLight ? "Switch to dark mode" : "Switch to light mode")
    : (isLight ? "Chuyển sang chế độ tối" : "Chuyển sang chế độ sáng");

  if (variant === "full") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        aria-label={tip}
        title={tip}
        className="w-full justify-start gap-2 h-10"
      >
        {isLight
          ? <Lightbulb className="w-4 h-4 text-warning shrink-0" />
          : <LightbulbOff className="w-4 h-4 shrink-0" />}
        <span className="text-xs">
          {isEn ? `Mode: ${isLight ? "Light" : "Dark"}` : `Chế độ: ${isLight ? "Sáng" : "Tối"}`}
        </span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={tip}
      title={tip}
      className="w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50"
    >
      {isLight
        ? <Lightbulb className="w-5 h-5 text-warning" />
        : <LightbulbOff className="w-5 h-5" />}
    </Button>
  );
};
