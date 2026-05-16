import { MoreVertical, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const APP_URL = "https://vinpoker.live";

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as any).MSStream;

const isAndroid = () =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export const OpenInBrowserMenu = () => {
  const [copied, setCopied] = useState(false);

  const openExternal = () => {
    const url = window.location.href || APP_URL;
    if (isIOS()) {
      // x-safari-https:// scheme forces Safari on iOS (works from in-app browsers)
      const safariUrl = url.replace(/^https?:\/\//, "x-safari-https://");
      window.location.href = safariUrl;
      // fallback after a moment
      setTimeout(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }, 400);
    } else if (isAndroid()) {
      // intent:// launches Chrome on Android
      const noScheme = url.replace(/^https?:\/\//, "");
      const intentUrl = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
      window.location.href = intentUrl;
      setTimeout(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }, 400);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href || APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Mở menu"
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Tuỳ chọn
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openExternal} className="gap-2 cursor-pointer">
          <ExternalLink className="w-4 h-4" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Mở bằng trình duyệt ngoài</span>
            <span className="text-[11px] text-muted-foreground">
              {isIOS() ? "Mở trong Safari" : isAndroid() ? "Mở trong Chrome" : "Mở tab mới"}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyLink} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
          <span className="text-sm">{copied ? "Đã sao chép link" : "Sao chép link"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
