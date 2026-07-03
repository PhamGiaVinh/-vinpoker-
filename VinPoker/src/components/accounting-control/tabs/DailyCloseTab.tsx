import { Check, Circle, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MOCK_DAILY_CLOSE, type CloseStepStatus } from "../mock/mockData";
import { DataStateBadge } from "../shared/DataStateBadge";
import { SpecNotice } from "../shared/Notices";
import { TabShell } from "../shared/TabShell";

const STEP_META: Record<CloseStepStatus, { icon: LucideIcon; cls: string }> = {
  done: { icon: Check, cls: "text-primary border-primary/40 bg-primary/10" },
  warning: { icon: TriangleAlert, cls: "text-amber-400 border-amber-500/40 bg-amber-500/10" },
  pending: { icon: Circle, cls: "text-muted-foreground border-muted-foreground/40 bg-transparent" },
  blocked: { icon: Lock, cls: "text-muted-foreground border-border bg-muted/30" },
};

export function DailyCloseTab({ close = MOCK_DAILY_CLOSE }: { close?: typeof MOCK_DAILY_CLOSE }) {
  return (
    <TabShell
      title="Chốt sổ cuối ngày"
      question="Cuối ngày, ai xác nhận số nào là thật?"
      doctrine={[
        "Một ngày chưa ký chốt sổ thì không con số nào của ngày đó được coi là số thật.",
      ]}
    >
      <SpecNotice note="Đây là quy trình mẫu của ngày 02/07 để duyệt thiết kế." />

      <Card className="p-3 md:p-4 gradient-card">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {close.dayLabel}
          </span>
          <DataStateBadge state="provisional" />
        </div>
        <ol>
          {close.steps.map((step, i) => {
            const meta = STEP_META[step.status];
            const Icon = meta.icon;
            return (
              <li key={step.id} className="relative pl-9 pb-4 last:pb-0">
                {i < close.steps.length - 1 && (
                  <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-border/60" />
                )}
                <span
                  className={`absolute left-0 top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border ${meta.cls}`}
                >
                  <Icon className="w-3 h-3" />
                </span>
                <p className="text-sm font-medium text-foreground/90 leading-[22px]">{step.label}</p>
                <p className="text-[11px] text-muted-foreground">{step.note}</p>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="p-3 md:p-4 border-amber-500/30 bg-amber-500/[0.04]">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-foreground/90">
          <span>Thu ngân đã kiểm</span>
          <span className="font-semibold text-primary">✓</span>
          <span className="text-muted-foreground">·</span>
          <span>
            Chủ CLB <span className="font-semibold text-amber-400">chưa ký</span>
          </span>
          <span className="text-muted-foreground">→</span>
          <span>toàn bộ số của ngày vẫn là</span>
          <DataStateBadge state="provisional" />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Sau khi ký chốt: mọi sửa đổi đi qua bút toán điều chỉnh — không sửa lịch sử.
        </p>
      </Card>
    </TabShell>
  );
}
