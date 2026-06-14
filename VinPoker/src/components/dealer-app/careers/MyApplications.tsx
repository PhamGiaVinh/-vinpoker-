import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealerApplications } from "@/hooks/dealer/useDealerApplications";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import type { CareerApplicationView } from "@/types/dealerApp";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** The dealer's applications. `extra` holds this session's optimistic applies. */
export function MyApplications({ extra }: { extra: CareerApplicationView[] }) {
  const { t } = useTranslation();
  const { data, isLoading } = useDealerApplications();
  const all = [...extra, ...(data ?? [])];

  if (isLoading && extra.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-2 py-12">
        <Inbox className="w-8 h-8 text-muted-foreground" />
        <div className="text-sm font-bold text-foreground">{t("dealer.careers.applications.empty", "Chưa có đơn ứng tuyển")}</div>
        <p className="text-xs text-muted-foreground max-w-[15rem]">
          {t("dealer.careers.applications.emptyHint", "Khám phá các cơ hội ở tab “Cơ hội” và ứng tuyển.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {all.map((a) => (
        <div key={a.id} className="rounded-2xl border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] font-bold text-foreground">{a.programTitle}</div>
            <ApplicationStatusBadge status={a.status} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {t("dealer.careers.applications.appliedOn", "Nộp ngày {{date}}", { date: fmtDate(a.createdAt) })}
          </div>
          {a.note && <div className="text-[12px] text-muted-foreground/90 mt-1.5 italic">“{a.note}”</div>}
        </div>
      ))}
    </div>
  );
}
