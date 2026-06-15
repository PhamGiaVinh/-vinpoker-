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
  onShare: () => void;
}

export function LiveHubHeader({ title, clubName, clubId, subtitle, liveTableCount, onShare }: LiveHubHeaderProps) {
  const { t } = useTranslation();
  return (
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
  );
}
