import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Headphones } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDealerCareers } from "@/hooks/dealer/useDealerCareers";
import { localTodayDate } from "@/lib/dealerApp/clock";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import { ProgramCard } from "./ProgramCard";
import { ProgramDetailSheet } from "./ProgramDetailSheet";
import { ApplyDialog } from "./ApplyDialog";
import { MyApplications } from "./MyApplications";
import { TrainingSchedule } from "./TrainingSchedule";
import { HrContactSheet } from "./HrContactSheet";
import type { CareerApplicationView, CareerProgramView } from "@/types/dealerApp";

type Tab = "opportunities" | "applications" | "training";

/**
 * Open dealer marketplace + careers hub. Visible to ANY authenticated user so
 * un-hired applicants can browse & apply — the open-market entry point. Inc 5 =
 * full UX on mock data (browse → detail → apply → my applications → training →
 * HR). Live data + real apply RPC wire in Inc 7 (after Migration B).
 */
export function CareersScreen() {
  const { t } = useTranslation();
  const { data: programs, isLoading } = useDealerCareers();
  const [tab, setTab] = useState<Tab>("opportunities");
  const [detail, setDetail] = useState<CareerProgramView | null>(null);
  const [apply, setApply] = useState<CareerProgramView | null>(null);
  const [hrOpen, setHrOpen] = useState(false);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const appliedSet = useMemo(() => new Set(appliedIds), [appliedIds]);

  // Ephemeral applications synthesized from this session's applies (demo only).
  const extraApps: CareerApplicationView[] = useMemo(() => {
    const byId = new Map((programs ?? []).map((p) => [p.id, p] as const));
    return appliedIds
      .map((id) => byId.get(id))
      .filter((p): p is CareerProgramView => !!p)
      .map((p) => ({
        id: `local-${p.id}`,
        programId: p.id,
        programTitle: p.title,
        kind: p.kind,
        status: "applied" as const,
        createdAt: `${localTodayDate()}T00:00:00+07:00`,
      }));
  }, [appliedIds, programs]);

  const tabs: { key: Tab; fb: string }[] = [
    { key: "opportunities", fb: "Cơ hội" },
    { key: "applications", fb: "Đơn của tôi" },
    { key: "training", fb: "Đào tạo" },
  ];

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-3">
        {t("dealer.careers.title", "Tuyển dụng & Đào tạo")}
      </h1>

      <div className="relative overflow-hidden rounded-2xl border border-[#E6B84C]/35 bg-card p-4 mb-3">
        <Globe className="absolute right-3 top-3 w-14 h-14 opacity-10" style={{ color: DEALER_GOLD }} />
        <div className="text-[11px] text-muted-foreground">{t("dealer.careers.heroSmall", "Phát triển sự nghiệp cùng")}</div>
        <div className="text-lg font-display font-black" style={{ color: DEALER_GOLD }}>
          VBACKER DEALER
        </div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {t("dealer.careers.heroSub", "Sàn dealer mở · Cơ hội trong nước & quốc tế")}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 bg-card border border-border rounded-xl p-1 mb-4">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              "py-2 rounded-lg text-[12px] font-bold transition-colors",
              tab === tb.key ? "bg-primary/15 text-primary border border-primary/35" : "text-muted-foreground"
            )}
          >
            {t(`dealer.careers.tabs.${tb.key}`, tb.fb)}
          </button>
        ))}
      </div>

      {tab === "opportunities" &&
        (isLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[128px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(programs ?? []).map((p) => (
              <ProgramCard key={p.id} program={p} applied={appliedSet.has(p.id)} onOpen={() => setDetail(p)} />
            ))}
          </div>
        ))}
      {tab === "applications" && <MyApplications extra={extraApps} />}
      {tab === "training" && <TrainingSchedule />}

      <button
        onClick={() => setHrOpen(true)}
        className="mt-3 w-full flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/5 p-4 font-bold text-primary"
      >
        <span className="flex items-center gap-2">
          <Headphones className="w-4 h-4" />
          {t("dealer.careers.contactHr", "Liên hệ Phòng Nhân sự")}
        </span>
        <span>›</span>
      </button>

      <ProgramDetailSheet
        program={detail}
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        applied={detail ? appliedSet.has(detail.id) : false}
        onApply={() => {
          setApply(detail);
          setDetail(null);
        }}
      />
      <ApplyDialog
        program={apply}
        open={!!apply}
        onOpenChange={(o) => {
          if (!o) setApply(null);
        }}
        onSubmitted={(id) => {
          setAppliedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
          setApply(null);
        }}
      />
      <HrContactSheet open={hrOpen} onOpenChange={setHrOpen} />
    </div>
  );
}
