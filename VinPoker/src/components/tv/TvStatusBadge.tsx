import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";

export function TvStatusBadge({ data }: { data: TvData }) {
  const { t } = useTranslation();

  let label: string;
  let colorClass: string;
  if (data.isBreak) {
    label = t("tv.breakTitle");
    colorClass = "border-sky-500/50 bg-sky-500/15 text-sky-400";
  } else if ((data.status === "live" || data.status === "final_table") && !data.isRunning) {
    label = t("tv.paused");
    colorClass = "border-amber-500/50 bg-amber-500/15 text-amber-400";
  } else if (data.status === "live" || data.status === "final_table") {
    label = t("tv.live");
    colorClass = "border-primary/50 bg-primary/15 text-primary";
  } else if (data.status === "finished" || data.status === "cancelled") {
    label = t(data.status === "finished" ? "tv.finished" : "tv.cancelled");
    colorClass = "border-border bg-muted/40 text-muted-foreground";
  } else {
    label = t("tv.scheduled");
    colorClass = "border-border bg-muted/40 text-muted-foreground";
  }

  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full border px-[1.4vmin] py-[0.5vmin] text-[1.8vmin] font-semibold uppercase tracking-widest ${colorClass}`}
    >
      {label}
    </span>
  );
}
