import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Props {
  /** Explicit destination. When omitted, goes back one step if there is
   *  in-app history, otherwise falls back to "/" (never traps deep-links). */
  to?: string;
  /** Label override. Defaults to common.back ("Quay lại"). */
  label?: string;
  className?: string;
}

/**
 * Shared back/home control with a mobile-friendly ≥44px tap target.
 * Standardizes the ad-hoc `nav(-1)` + ArrowLeft pattern used across detail pages.
 */
export function BackButton({ to, label, className }: Props) {
  const nav = useNavigate();
  const { t } = useTranslation();

  const handleClick = () => {
    if (to) {
      nav(to);
      return;
    }
    // react-router stores a monotonic history index in history.state.idx.
    // idx > 0 means we have in-app history to pop; otherwise (direct/deep
    // link, fresh tab) fall back to Home so the user is never trapped.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav("/");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 min-h-[44px] -ml-1 pr-2 text-sm text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
    >
      <ArrowLeft className="w-5 h-5 shrink-0" />
      {label ?? t("common.back")}
    </button>
  );
}

export default BackButton;
