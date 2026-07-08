import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStaffLink } from "@/hooks/staff/useStaffLink";

export function StaffClubSwitcher() {
  const { memberships, staff, setSelectedStaffId } = useStaffLink();
  if (memberships.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 max-w-[40vw] px-2 h-8 rounded-lg bg-card border border-border text-foreground text-[12px] font-bold hover:border-primary/40 transition-colors"
          aria-label="Đổi CLB"
        >
          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">{staff?.clubName || "Đổi CLB"}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Câu lạc bộ</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem key={m.staffId} onClick={() => setSelectedStaffId(m.staffId)} className="gap-2 cursor-pointer">
            <Building2 className="w-4 h-4" />
            <span className="flex-1 truncate">{m.clubName}</span>
            {m.staffId === staff?.staffId && <Check className="w-4 h-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

