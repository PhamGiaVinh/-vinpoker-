import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyTheme, getStoredTheme, THEMES, type AppTheme } from "@/lib/theme";

interface Props {
  variant?: "compact" | "full";
}

export const ThemeSwitcher = ({ variant = "compact" }: Props) => {
  const { i18n } = useTranslation();
  const isEn = (i18n.language || "").toLowerCase().startsWith("en");
  const [theme, setTheme] = useState<AppTheme>("default");

  // Read the persisted choice on mount (kept in sync with the early-apply
  // inline script in index.html). Does not change the applied theme here.
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const change = (v: string) => {
    const next = v as AppTheme;
    setTheme(next);
    applyTheme(next);
  };

  const label = (tt: { value: AppTheme; labelVi: string; labelEn: string }) =>
    isEn ? tt.labelEn : tt.labelVi;

  return (
    <Select value={theme} onValueChange={change}>
      <SelectTrigger
        className={variant === "compact" ? "h-9 w-[150px] text-xs" : "h-10 w-full"}
        aria-label={isEn ? "Theme" : "Giao diện"}
      >
        <div className="flex items-center gap-1 min-w-0">
          <Palette className="w-3.5 h-3.5 shrink-0" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((tt) => (
          <SelectItem key={tt.value} value={tt.value}>
            {label(tt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
