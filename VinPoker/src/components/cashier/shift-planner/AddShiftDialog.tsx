import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { isNightShift, shiftDurationHours } from "@/lib/shiftPlanner";
import { shiftWindowLabel } from "./ShiftPlanner.utils";
import type { DealerRole, DraftAssignment, SchedulerDealer, ShiftTemplate } from "@/types/shiftPlanner";

/**
 * Manually assign a dealer to a shift window — the floor's explicit "gán lịch thủ
 * công" path, complementing the AI auto-draft. Builds a draft assignment from a real
 * shift template (so template_id stays FK-valid for save_shift_run) regardless of the
 * dealer's availability. The parent persists it via the existing Save/Publish flow.
 */
export function AddShiftDialog({
  open,
  onOpenChange,
  dealers,
  templates,
  workDate,
  tzOffsetMinutes,
  assignedDealerIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dealers: SchedulerDealer[];
  templates: ShiftTemplate[];
  workDate: string;
  tzOffsetMinutes: number;
  assignedDealerIds: Set<string>;
  onAdd: (a: DraftAssignment) => void;
}) {
  const [dealerId, setDealerId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [role, setRole] = useState<DealerRole>("Dealer");

  // Only active dealers are assignable.
  const activeDealers = useMemo(
    () => dealers.filter((d) => d.status === "active").sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [dealers]
  );

  const reset = () => {
    setDealerId("");
    setTemplateId("");
    setRole("Dealer");
  };

  const submit = () => {
    const dealer = activeDealers.find((d) => d.id === dealerId);
    const tpl = templates.find((t) => t.id === templateId);
    if (!dealer || !tpl) {
      toast.error("Chọn dealer và khung ca.");
      return;
    }
    if (assignedDealerIds.has(dealer.id)) {
      toast.error(`${dealer.fullName} đã có ca hôm nay — xoá ca cũ trước (mỗi dealer 1 ca/ngày).`);
      return;
    }
    const assignment: DraftAssignment = {
      templateId: tpl.id,
      templateLabel: tpl.label,
      dealerId: dealer.id,
      dealerName: dealer.fullName,
      workDate,
      scheduledStartAt: tpl.startAt,
      scheduledEndAt: tpl.endAt,
      durationHours: Math.round(shiftDurationHours(tpl.startAt, tpl.endAt) * 10) / 10,
      role,
      status: "draft",
      score: 0,
      scoreBreakdown: [],
      reasons: ["Gán thủ công"],
      isNightShift: isNightShift(tpl.startAt, tpl.endAt, tzOffsetMinutes),
    };
    onAdd(assignment);
    toast.success(`Đã thêm ${dealer.fullName} vào ca ${tpl.label}`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> Gán ca thủ công
          </DialogTitle>
          <DialogDescription>Chọn dealer và khung ca — không phụ thuộc đăng ký rảnh.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Dealer</label>
            <Select value={dealerId} onValueChange={setDealerId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn dealer…" />
              </SelectTrigger>
              <SelectContent>
                {activeDealers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Không có dealer active</div>
                ) : (
                  activeDealers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.fullName}
                      {assignedDealerIds.has(d.id) ? " · đã có ca" : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Khung ca</label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn khung ca…" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Chưa có khung ca — tạo ở "Quản lý ca"
                  </div>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label} · {shiftWindowLabel(t)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Vai trò</label>
            <Select value={role} onValueChange={(v) => setRole(v as DealerRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Dealer">Dealer</SelectItem>
                <SelectItem value="Lead">Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!dealerId || !templateId}
            className="gradient-neon text-primary-foreground border-0 font-bold w-full"
          >
            Thêm ca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
