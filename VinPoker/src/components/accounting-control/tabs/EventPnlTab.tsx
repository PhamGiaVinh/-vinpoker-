import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { MOCK_EVENTS } from "../mock/mockData";
import type { DataState, EventPnlFixture, MoneyLine } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { LiabilityCard } from "../shared/LiabilityCard";
import { TabShell } from "../shared/TabShell";

/** Một bậc trong thang đóng góp — mọi con số mang con dấu trạng thái, tabular-nums. */
function LadderRow({
  sign, label, amount, state, tone = "text-foreground/80", bold, note,
}: {
  sign: "+" | "−" | "="; label: string; amount: number; state: DataState;
  tone?: string; bold?: boolean; note?: string;
}) {
  return (
    <div className="py-2 border-b border-border/60 last:border-b-0">
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${bold ? "font-semibold" : ""}`}>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-3 shrink-0 text-muted-foreground">{sign}</span>
          <span className={tone}>{label}</span>
          <DataStateBadge state={state} />
        </span>
        <span className={`text-sm tabular-nums ${tone}`}>{formatVND(amount)}</span>
      </div>
      {note && <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Chi phí ĐÃ BIẾT đang thiếu số liệu — cảnh báo, không bao giờ hiển thị "0 ₫". */
function MissingCostRow({ line }: { line: MoneyLine }) {
  return (
    <div className="my-1.5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div className="min-w-0">
        <p className="text-sm text-amber-200/90">
          − {line.label}: <span className="font-semibold">chưa có số</span>
        </p>
        {line.note && <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">{line.note}</p>}
      </div>
    </div>
  );
}

const displayDate = (iso: string) => iso.split("-").reverse().join("/");

export function EventPnlTab({ events = MOCK_EVENTS }: { events?: EventPnlFixture[] }) {
  const [selectedId, setSelectedId] = useState(events[0]?.id);
  const event = events.find((e) => e.id === selectedId) ?? events[0];
  if (!event) return null;

  const showBreakEven = event.breakEvenGtdEntries !== null && event.breakEvenContributionEntries !== null;
  const shortfall =
    event.breakEvenContributionEntries !== null && event.entries < event.breakEvenContributionEntries
      ? event.breakEvenContributionEntries - event.entries
      : 0;

  return (
    <TabShell
      title="Event P&L — Biên đóng góp theo giải"
      question="Giải này club thực sự lời hay lỗ bao nhiêu từ phí?"
      doctrine={[
        "Prize pool là tiền của người chơi mà club giữ hộ — không bao giờ được tính là doanh thu.",
        "Biên đóng góp chưa trừ chi phí vận hành chung (mặt bằng, điện nước…) — chưa phải kết quả cuối cùng.",
        "Số Tạm tính có thể đổi tới khi chốt sổ — chỉ số Đã chốt mới bất biến.",
      ]}
    >
      <div className="flex flex-wrap gap-2">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={e.id === event.id}
            onClick={() => setSelectedId(e.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              e.id === event.id
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {e.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{event.name}</h3>
        <span className="text-[12px] text-muted-foreground">{displayDate(event.date)}</span>
        <DataStateBadge state={event.state} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <aside className="space-y-1.5 md:order-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Tiền người chơi (không phải doanh thu)
          </p>
          <LiabilityCard
            label="Prize pool người chơi đóng"
            amount={event.playerFundedPool}
            state={event.state}
            note={`${event.entries} entries × ${formatVND(event.poolPerEntry)} vào pool — club chỉ giữ hộ để trả giải.`}
          />
        </aside>

        <Card className="gradient-card p-3 md:order-1 md:col-span-2 md:p-4">
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Thang đóng góp</p>
          <LadderRow
            sign="+" label="Doanh thu giữ lại (phí)" amount={event.retainedFee} state={event.state}
            tone="text-primary" note={`${event.entries} entries × ${formatVND(event.feePerEntry)} phí mỗi entry`}
          />
          {event.otherRevenue > 0 && (
            <LadderRow sign="+" label="Doanh thu khác club giữ lại" amount={event.otherRevenue} state={event.state} tone="text-primary" />
          )}
          {event.gtd !== null && (
            <LadderRow
              sign="−" label="Bù đắp GTD" amount={event.gtdSubsidy} state={event.state}
              note={`GTD ${formatVND(event.gtd)} − pool người chơi đóng ${formatVND(event.playerFundedPool)}`}
            />
          )}
          {event.costs.map((c) =>
            c.missing ? (
              <MissingCostRow key={c.id} line={c} />
            ) : (
              <LadderRow key={c.id} sign="−" label={c.label} amount={c.amount} state={c.state} note={c.note} />
            ),
          )}
          <LadderRow
            sign="=" label="Biên đóng góp (chưa trừ chi phí vận hành chung)" amount={event.contribution}
            state={event.state} bold tone={event.contribution < 0 ? "text-red-400" : "text-primary"}
          />
        </Card>
      </div>

      {showBreakEven && (
        <Card className="space-y-1.5 p-3 md:p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Ngưỡng hòa vốn của giải</p>
          <p className="text-[12px] tabular-nums text-muted-foreground">
            Hòa vốn GTD (đủ phủ đảm bảo): {event.breakEvenGtdEntries} entries
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium tabular-nums text-foreground">
            <span>
              Hòa vốn đóng góp (gồm chi phí trực tiếp): {event.breakEvenContributionEntries} entries — đạt {event.entries}
            </span>
            {shortfall > 0 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                thiếu {shortfall} entries
              </span>
            )}
          </div>
        </Card>
      )}
    </TabShell>
  );
}
