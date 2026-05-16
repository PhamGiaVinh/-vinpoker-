import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  variant?: "compact" | "full";
}

const normalize = (lng?: string) => {
  if (!lng) return "vi";
  const l = lng.toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("en")) return "en";
  return "vi";
};

export const LanguageSwitcher = ({ variant = "compact" }: Props) => {
  const { i18n } = useTranslation();
  const current = normalize(i18n.language);

  const change = (v: string) => {
    i18n.changeLanguage(v);
    try {
      localStorage.setItem("vinpoker.lang", v);
      localStorage.setItem("vinpoker.lang.manual", "1");
    } catch {}
  };

  return (
    <Select value={current} onValueChange={change}>
      <SelectTrigger className={variant === "compact" ? "h-9 w-[96px] text-xs" : "h-10 w-full"}>
        <div className="flex items-center gap-1">
          <Globe className="w-3.5 h-3.5" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="vi">🇻🇳 VIE</SelectItem>
        <SelectItem value="en">🇺🇸 ENG</SelectItem>
        <SelectItem value="zh-CN">🇨🇳 中文</SelectItem>
        <SelectItem value="ko">🇰🇷 KOR</SelectItem>
      </SelectContent>
    </Select>
  );
};
