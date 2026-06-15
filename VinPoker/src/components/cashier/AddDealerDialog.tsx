import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AddDealerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  onDealerAdded: () => void;
}

export default function AddDealerDialog({
  open,
  onOpenChange,
  clubId,
  onDealerAdded,
}: AddDealerDialogProps) {
  const [fullName, setFullName] = useState("");
  const [tier, setTier] = useState("C");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [hourlyRate, setHourlyRate] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("9000000");
  const [standardHours, setStandardHours] = useState("8");
  const [otMultiplier, setOtMultiplier] = useState("1.5");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isPT = employmentType === "part_time";

  const reset = () => {
    setFullName("");
    setTier("C");
    setEmploymentType("full_time");
    setHourlyRate("");
    setMonthlySalary("9000000");
    setStandardHours("8");
    setOtMultiplier("1.5");
    setPhone("");
    setNotes("");
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Vui lòng nhập tên dealer");
      return;
    }
    if (!clubId) {
      toast.error("Không xác định được CLB");
      return;
    }
    setSaving(true);
    try {
      const monthlySalaryNum = !isPT && monthlySalary ? parseInt(monthlySalary, 10) : 0;
      const standardHoursNum = parseFloat(standardHours) || 8;
      const otMultiplierNum = parseFloat(otMultiplier) || 1.5;

      // Auto-derive hourly rate for full-time from monthly salary
      const hourlyRateNum = isPT
        ? (hourlyRate ? parseInt(hourlyRate, 10) : null)
        : (monthlySalaryNum > 0 ? Math.round(monthlySalaryNum / 26 / standardHoursNum) : (hourlyRate ? parseInt(hourlyRate, 10) : null));

      const { error } = await supabase.from("dealers").insert({
        club_id: clubId,
        full_name: fullName.trim(),
        tier,
        employment_type: employmentType,
        hourly_rate_vnd: hourlyRateNum,
        base_rate_vnd: monthlySalaryNum > 0 ? Math.round(monthlySalaryNum / 26) : null,
        monthly_salary_vnd: isPT ? 0 : monthlySalaryNum,
        standard_hours_per_shift: standardHoursNum,
        ot_multiplier: otMultiplierNum,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        joined_date: new Date().toISOString().split("T")[0],
        status: "active",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Đã thêm dealer mới");
      reset();
      onOpenChange(false);
      onDealerAdded();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi khi thêm dealer");
    } finally {
      setSaving(false);
    }
  };

  // Computed: auto-derive hourly rate display
  const derivedHourlyRate = isPT
    ? (parseInt(hourlyRate) || 0)
    : monthlySalary && parseInt(monthlySalary) > 0
      ? Math.round(parseInt(monthlySalary) / 26 / (parseFloat(standardHours) || 8))
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thêm Dealer Mới</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Nhập thông tin dealer để thêm vào danh sách
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="fullName">Tên dealer *</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nguyễn Văn A"
              className="bg-card border-border text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Hạng</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value="A">A — Cao cấp</SelectItem>
                  <SelectItem value="B">B — Trung cấp</SelectItem>
                  <SelectItem value="C">C — Cơ bản</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Loại</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Payroll Fields ── */}
          {isPT ? (
            /* Part-time: chỉ cần hourly rate */
            <div>
              <Label>Lương giờ (VND/h)</Label>
              <Input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="VD: 100000"
                className="bg-card border-border text-foreground"
              />
            </div>
          ) : (
            /* Full-time: lương tháng + auto-derive hourly */
            <>
              <div>
                <Label>Lương tháng (VND)</Label>
                <Input
                  type="number"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  placeholder="VD: 9000000"
                  className="bg-card border-border text-foreground"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Giờ chuẩn/ca</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={standardHours}
                    onChange={(e) => setStandardHours(e.target.value)}
                    placeholder="8"
                    className="bg-card border-border text-foreground"
                  />
                </div>
                <div>
                  <Label>Hệ số OT</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={otMultiplier}
                    onChange={(e) => setOtMultiplier(e.target.value)}
                    placeholder="1.5"
                    className="bg-card border-border text-foreground"
                  />
                </div>
              </div>
              {derivedHourlyRate > 0 && (
                <div className="text-xs text-muted-foreground">
                  Lương giờ tự tính: {derivedHourlyRate.toLocaleString("vi-VN")} VND/h
                </div>
              )}
            </>
          )}

          <div>
            <Label>Số điện thoại</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="090xxxxxxx"
              className="bg-card border-border text-foreground"
            />
          </div>
          <div>
            <Label>Ghi chú</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              className="bg-card border-border text-foreground"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => { reset(); onOpenChange(false); }}
              className="border-border text-foreground"
            >
              Hủy
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !fullName.trim()}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {saving ? "Đang lưu..." : "Thêm dealer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}