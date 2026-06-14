import { useTranslation } from "react-i18next";
import { Video, MapPin, CalendarClock, GraduationCap, Mic, CalendarOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDealerTrainingSessions } from "@/hooks/dealer/useDealerTrainingSessions";
import { formatHm } from "@/lib/dealerApp/selectors";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const STATUS: Record<string, { cls: string; fb: string }> = {
  scheduled: { cls: "text-primary border-primary/35 bg-primary/10", fb: "Sắp diễn ra" },
  done: { cls: "text-muted-foreground border-border bg-muted", fb: "Đã xong" },
  cancelled: { cls: "text-destructive border-destructive/30 bg-destructive/10", fb: "Đã huỷ" },
};

export function TrainingSchedule() {
  const { t } = useTranslation();
  const { data, isLoading } = useDealerTrainingSessions();
  const sessions = [...(data ?? [])].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-2 py-12">
        <CalendarOff className="w-8 h-8 text-muted-foreground" />
        <div className="text-sm font-bold text-foreground">{t("dealer.careers.training.empty", "Chưa có lịch đào tạo")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const st = STATUS[s.status] ?? STATUS.scheduled;
        const KindIcon = s.kind === "interview" ? Mic : GraduationCap;
        return (
          <div key={s.id} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="grid place-items-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 text-primary shrink-0">
                  <KindIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-foreground leading-tight">{s.title}</div>
                  {s.programTitle && <div className="text-[10px] text-muted-foreground truncate">{s.programTitle}</div>}
                </div>
              </div>
              <span className={cn("shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold", st.cls)}>
                {t(`dealer.careers.sessionStatus.${s.status}`, st.fb)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5" />
                {fmtDate(s.scheduledAt)} · {formatHm(s.scheduledAt)}
              </span>
              {s.mode === "online" ? (
                <span className="inline-flex items-center gap-1 text-[hsl(var(--ds-active))]">
                  <Video className="w-3.5 h-3.5" />
                  {t("dealer.careers.training.online", "Online")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 truncate">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {s.location}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
