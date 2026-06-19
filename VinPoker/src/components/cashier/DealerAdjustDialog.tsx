import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealerData {
  id: string;
  full_name: string;
  tier: string;
  employment_type: string;
  hourly_rate_vnd: number | null;
  base_rate_vnd: number | null;
  monthly_salary_vnd: number | null;
  standard_hours_per_shift: number | null;
  ot_multiplier: number | null;
  notes: string | null;
  manual_bhxh_vnd?: number | null;
  manual_tax_vnd?: number | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DealerAdjustDialog({
  dealer, open, onClose, onSaved,
}: {
  dealer: DealerData | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Form fields
  const [tier, setTier] = useState("C");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [hourlyRate, setHourlyRate] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [standardHours, setStandardHours] = useState("8");
  const [otMultiplier, setOtMultiplier] = useState("1.5");
  const [notes, setNotes] = useState("");
  // Manual BHXH/tax override ("" = auto-compute, "0" = none, ">0" = exact). Gated by flag.
  const [manualBhxh, setManualBhxh] = useState("");
  const [manualTax, setManualTax] = useState("");
  const [saving, setSaving] = useState(false);

  // Dealer scores
  const [totalHours, setTotalHours] = useState<number | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editWorkedHours, setEditWorkedHours] = useState("");

  const isPT = employmentType === "part_time";

  // ─── Reset form when dealer changes (key on id) ──────────────────────────
  useEffect(() => {
    if (!dealer) return;
    setTier(dealer.tier);
    setEmploymentType(dealer.employment_type);
    setHourlyRate(String(dealer.hourly_rate_vnd ?? ""));
    setMonthlySalary(String(dealer.monthly_salary_vnd ?? ""));
    setStandardHours(String(dealer.standard_hours_per_shift ?? 8));
    setOtMultiplier(String(dealer.ot_multiplier ?? 1.5));
    setNotes(dealer.notes ?? "");
    setManualBhxh(dealer.manual_bhxh_vnd == null ? "" : String(dealer.manual_bhxh_vnd));
    setManualTax(dealer.manual_tax_vnd == null ? "" : String(dealer.manual_tax_vnd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealer?.id]);

  // ─── Load dealer_scores on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!open || !dealer?.id) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("dealer_scores")
        .select("score, total_hours, worked_hours, overridden_score")
        .eq("dealer_id", dealer.id)
        .maybeSingle();
      if (data) {
        setTotalHours((data as any).total_hours ?? null);
        setEditScore(String((data as any).overridden_score ?? (data as any).score ?? ""));
        setEditWorkedHours(String((data as any).worked_hours ?? ""));
      } else {
        setTotalHours(null);
        setEditScore("");
        setEditWorkedHours("");
      }
    })();
  }, [open, dealer?.id]);

  // ─── Computed values ────────────────────────────────────────────────────────
  const hourlyNum = parseFloat(hourlyRate) || 0;
  const monthlySalaryNum = parseInt(monthlySalary) || 0;
  const standardHoursNum = parseFloat(standardHours) || 8;
  const otMultiplierNum = parseFloat(otMultiplier) || 1.5;

  // Auto-derive hourly rate from monthly salary for full-time
  const derivedHourlyRate = isPT
    ? hourlyNum
    : monthlySalaryNum > 0
      ? Math.round(monthlySalaryNum / 26 / standardHoursNum)
      : hourlyNum;

  // ─── Validate ALL numeric inputs ──────────────────────────────────────────
  function validateForm(): string | null {
    if (hourlyRate !== "") {
      const hr = Number(hourlyRate);
      if (isNaN(hr) || hr < 0) return "Lương giờ không hợp lệ — vui lòng nhập số dương";
    }
    if (!isPT && monthlySalary !== "") {
      const ms = Number(monthlySalary);
      if (isNaN(ms) || ms < 0) return "Lương tháng không hợp lệ — vui lòng nhập số dương";
    }
    if (standardHours !== "") {
      const sh = Number(standardHours);
      if (isNaN(sh) || sh <= 0 || sh > 24) return "Giờ chuẩn/ca phải từ 1-24";
    }
    if (otMultiplier !== "") {
      const om = Number(otMultiplier);
      if (isNaN(om) || om < 1 || om > 3) return "Hệ số OT phải từ 1.0-3.0";
    }
    if (editScore !== "") {
      const s = Number(editScore);
      if (isNaN(s)) return "Điểm số không hợp lệ — vui lòng nhập số";
    }
    if (editWorkedHours !== "") {
      const wh = Number(editWorkedHours);
      if (isNaN(wh) || wh < 0) return "Giờ làm việc không hợp lệ — vui lòng nhập số dương";
    }
    return null;
  }

  // ─── Save handler ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!dealer) return;

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const hourlyRateNum = hourlyRate ? parseInt(hourlyRate, 10) : null;
      const monthlySalarySave = !isPT && monthlySalary ? parseInt(monthlySalary, 10) : 0;
      const standardHoursSave = parseFloat(standardHours) || 8;
      const otMultiplierSave = parseFloat(otMultiplier) || 1.5;

      const payload: Record<string, unknown> = {
        tier,
        employment_type: employmentType,
        hourly_rate_vnd: isPT ? hourlyRateNum : (monthlySalarySave > 0 ? Math.round(monthlySalarySave / 26 / standardHoursSave) : hourlyRateNum),
        base_rate_vnd: monthlySalarySave > 0 ? Math.round(monthlySalarySave / 26) : null,
        monthly_salary_vnd: isPT ? 0 : monthlySalarySave,
        standard_hours_per_shift: standardHoursSave,
        ot_multiplier: otMultiplierSave,
        notes: notes || null,
      };
      // Manual BHXH/tax override (flag-gated; columns only exist after the owner-gated apply).
      // "" => NULL (auto-compute); a number (incl. 0) => fixed override.
      if (FEATURES.manualPayrollDeductions) {
        payload.manual_bhxh_vnd = manualBhxh.trim() === "" ? null : Math.max(0, parseInt(manualBhxh, 10) || 0);
        payload.manual_tax_vnd = manualTax.trim() === "" ? null : Math.max(0, parseInt(manualTax, 10) || 0);
      }

      const { error: dealerErr } = await (supabase.from("dealers") as any).update(payload).eq("id", dealer.id);

      if (dealerErr) throw dealerErr;

      // Save score & worked_hours overrides
      if (editScore !== "" || editWorkedHours !== "") {
        const overrides: Record<string, string | number | null> = {
          dealer_id: dealer.id,
        };
        if (editScore !== "") overrides.score = Number(editScore);
        if (editWorkedHours !== "") overrides.worked_hours = Number(editWorkedHours);

        const { error: scoreErr } = await (supabase as any)
          .from("dealer_score_overrides")
          .upsert(overrides, { onConflict: "dealer_id" });

        if (scoreErr) throw scoreErr;
      }

      toast.success("Đã cập nhật thông tin dealer");
      onSaved();
      onClose();
    } catch (e: unknown) {
      let msg = "Lỗi không xác định";
      if (e instanceof Error) {
        msg = e.message;
      } else if (typeof e === "string") {
        msg = e;
      } else if (e && typeof e === "object" && "message" in e) {
        msg = String((e as { message: unknown }).message);
      }
      toast.error(`Lưu thất bại: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {dealer ? `Điều chỉnh — ${dealer.full_name}` : "Điều chỉnh dealer"}
          </DialogTitle>
        </DialogHeader>

        {dealer && (
          <div className="space-y-3">
            {/* ── Salary Summary Card ── */}
            <div className="p-3 bg-success/10 border border-success/30 rounded-sm text-sm">
              <div className="font-semibold text-success mb-1">
                {isPT ? "Lương part-time" : "Lương full-time"}
              </div>
              {isPT ? (
                <>
                  <span className="text-white font-bold">
                    {totalHours != null && hourlyNum > 0
                      ? `${Math.round(totalHours * hourlyNum).toLocaleString("vi-VN")} VND`
                      : "—"}
                  </span>
                  {totalHours != null && hourlyNum > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({totalHours.toFixed(1)}h × {hourlyNum.toLocaleString("vi-VN")}/h)
                    </span>
                  )}
                </>
              ) : (
                <>
                  <div className="text-white">
                    <span className="text-muted-foreground">Lương tháng: </span>
                    <span className="font-bold">{monthlySalaryNum > 0 ? monthlySalaryNum.toLocaleString("vi-VN") : "—"} VND</span>
                  </div>
                  {monthlySalaryNum > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Lương giờ: {derivedHourlyRate.toLocaleString("vi-VN")} VND/h • OT: ×{otMultiplierNum}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Loại hợp đồng */}
            <div>
              <Label className="text-xs">Loại hợp đồng</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Hạng (Tier) */}
            <div>
              <Label className="text-xs">Hạng (Tier)</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ── Payroll Fields ── */}
            {isPT ? (
              /* Part-time: chỉ cần hourly rate */
              <div>
                <Label className="text-xs">Lương giờ (VND/h)</Label>
                <Input
                  type="number"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="VD: 100000"
                  className="text-xs"
                />
              </div>
            ) : (
              /* Full-time: lương tháng + auto-derive hourly */
              <>
                <div>
                  <Label className="text-xs">Lương tháng (VND)</Label>
                  <Input
                    type="number"
                    value={monthlySalary}
                    onChange={(e) => setMonthlySalary(e.target.value)}
                    placeholder="VD: 9000000"
                    className="text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Giờ chuẩn/ca</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={standardHours}
                      onChange={(e) => setStandardHours(e.target.value)}
                      placeholder="8"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hệ số OT</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={otMultiplier}
                      onChange={(e) => setOtMultiplier(e.target.value)}
                      placeholder="1.5"
                      className="text-xs"
                    />
                  </div>
                </div>
                {monthlySalaryNum > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Lương giờ tự tính: {derivedHourlyRate.toLocaleString("vi-VN")} VND/h
                    (={monthlySalaryNum.toLocaleString("vi-VN")} ÷ 26 ngày ÷ {standardHoursNum}h)
                  </div>
                )}
              </>
            )}

            {/* ── Score & Hours ── */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <div>
                <Label className="text-xs">Điểm</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={editScore}
                  onChange={(e) => setEditScore(e.target.value)}
                  placeholder="VD: 4.5"
                  className="text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Số giờ đã làm</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={editWorkedHours}
                  onChange={(e) =>setEditWorkedHours(e.target.value)}
                  placeholder="VD: 40"
                  className="text-xs"
                />
              </div>
            </div>

            {/* ── Khấu trừ thủ công (BHXH + thuế) ── */}
            {FEATURES.manualPayrollDeductions && (
              <div className="pt-2 border-t border-border space-y-2">
                <div className="text-xs font-semibold text-warning">Khấu trừ thủ công (tùy chọn)</div>
                <p className="text-[11px] text-muted-foreground -mt-1">Để trống = tự động tính · nhập <span className="font-mono">0</span> = không thu · nhập số = dùng số đó.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">BHXH (VND)</Label>
                    <Input
                      type="number"
                      value={manualBhxh}
                      onChange={(e) => setManualBhxh(e.target.value)}
                      placeholder="Tự động"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Thuế TNCN (VND)</Label>
                    <Input
                      type="number"
                      value={manualTax}
                      onChange={(e) => setManualTax(e.target.value)}
                      placeholder="Tự động"
                      className="text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Ghi chú */}
            <div>
              <Label className="text-xs">Ghi chú</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" rows={2} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button onClick={handleSave} disabled={saving || !dealer}>
            {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
