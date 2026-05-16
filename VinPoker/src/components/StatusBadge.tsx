import { cn } from "@/lib/utils";

type Status = "pending" | "confirmed" | "rejected" | "cancelled";

const map: Record<Status, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-warning/15 text-warning border-warning/30" },
  confirmed: { label: "Confirmed", cls: "bg-success/15 text-success border-success/30" },
  rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
};

export const StatusBadge = ({ status }: { status: Status }) => {
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", s.cls)}>
      {s.label}
    </span>
  );
};
