interface Props {
  totalTables: number;
  assignedTables: number;
  otTables: number;
  availableDealers: number;
  needAttention: number;
}

function KpiBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="border border-border rounded-sm px-2.5 py-1.5">
      <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{label}</div>
    </div>
  );
}

export default function SystemHealthCard({
  totalTables, assignedTables, otTables, availableDealers, needAttention,
}: Props) {
  const coverageDisplay = totalTables > 0 ? `${assignedTables}/${totalTables}` : "—";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tình hình hệ thống
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <KpiBox
          label="Bàn đã gán"
          value={coverageDisplay}
          color={totalTables > 0 && assignedTables === totalTables ? "text-success" : "text-warning"}
        />
        <KpiBox
          label="OT"
          value={otTables}
          color={otTables > 0 ? "text-destructive" : "text-muted-foreground"}
        />
        <KpiBox
          label="Sẵn sàng"
          value={availableDealers}
          color={availableDealers > 0 ? "text-success" : "text-muted-foreground"}
        />
        <KpiBox
          label="Cần xử lý"
          value={needAttention}
          color={needAttention > 0 ? "text-destructive" : "text-success"}
        />
      </div>
    </div>
  );
}
