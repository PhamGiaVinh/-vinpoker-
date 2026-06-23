// Public "Live Poker Event Hub" header (Viewer Event Hub — Increment A).
// Presentational only: premium live-event header (TRỰC TIẾP badge + title + club
// + share). Uses the existing VinPoker tracker visual language (emerald = live,
// amber/gold = premium). No data fetching, no logic.

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LiveHubHeaderProps {
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  /** Optional small subtitle (e.g. Main Event / level) when data exists. */
  subtitle?: string | null;
  /** Optional live-table count badge ("X bàn trực tiếp"); omitted when <= 0. */
  liveTableCount?: number;
  /** Event info chips (RPT-style): guarantee / buy-in / starting stack. */
  guarantee?: number | null;
  buyIn?: number | null;
  startingStack?: number | null;
  /** When the hub data was last refreshed → "Cập nhật … trước". */
  lastUpdated?: Date | null;
  onShare: () => void;
}

const fmtMoney = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
};

export function LiveHubHeader({ title, clubName, clubId, subtitle, liveTableCount, guarantee, buyIn, startingStack, lastUpdated, onShare }: LiveHubHeaderProps) {
  const { t } = useTranslation();

  const timeAgo = (d: Date) => {
    const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 45) return t("liveHub.header.justNow", "vừa xong");
    if (s < 3600) return t("liveHub.header.minsAgo", "{{n}} phút trước", { n: Math.round(s / 60) });
    if (s < 86400) return t("liveHub.header.hoursAgo", "{{n}} giờ trước", { n: Math.round(s / 3600) });
    return t("liveHub.header.daysAgo", "{{n}} ngày trước", { n: Math.round(s / 86400) });
  };

  const chips: { label: string; value: string }[] = [];
  if (guarantee != null && guarantee > 0) chips.push({ label: "GTD", value: fmtMoney(guarantee) });
  if (buyIn != null && buyIn > 0) chips.push({ label: t("liveHub.header.buyIn", "BUY-IN"), value: fmtMoney(buyIn) });
  if (startingStack != null && startingStack > 0) chips.push({ label: "STACK", value: fmtMoney(startingStack) });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-success/10 text-success rounded-md text-[11px] sm:text-xs font-bold border border-success/30 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {t("liveHub.header.live", "TRỰC TIẾP")}
          {liveTableCount != null && liveTableCount > 0 && (
            <span className="ml-1 text-success/90">· {t("liveHub.header.tables", "{{count}} bàn", { count: liveTableCount })}</span>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="tracker-display font-bold text-base sm:text-xl leading-tight truncate">{title}</h1>
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : clubName && clubId ? (
            <Link
              to={`/club/${clubId}`}
              className="text-xs text-muted-foreground hover:text-success transition-colors"
            >
              {clubName}
            </Link>
          ) : clubName ? (
            <div className="text-xs text-muted-foreground truncate">{clubName}</div>
          ) : null}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onShare}
        className="tracker-display shrink-0 font-bold text-white shadow-sm hover:opacity-90"
        style={{ background: "hsl(var(--poker-accent))" }}
      >
        <Share2 className="w-3.5 h-3.5 mr-1.5" /> {t("liveHub.header.share", "Chia sẻ")}
      </Button>
      </div>
      {(chips.length > 0 || lastUpdated) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="tracker-display inline-flex items-center gap-1 rounded-md border border-border/50 bg-card/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              <span className="text-muted-foreground">{c.label}</span>
              <span className="tracker-num text-foreground">{c.value}</span>
            </span>
          ))}
          {lastUpdated && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {t("liveHub.header.updated", "Cập nhật")} {timeAgo(lastUpdated)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
