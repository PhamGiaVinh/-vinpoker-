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

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealerData {
  id: string;
  full_name: string;
  tier: string;
  employment_type: string;
  hourly_rate_vnd: number | null;
  base_rate_vnd: number | null;
  notes: string | null;
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
  const [baseRate, setBaseRate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Dealer scores
  const [score, setScore] = useState<number | null>(null);
  const [totalHours, setTotalHours] = useState<number | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editWorkedHours, setEditWorkedHours] = useState("");

  const isPT = employmentType === "part_time";

  // ─── [C5c] Reset form when dealer changes (key on id) ──────────────────────
  useEffect(() => {
    if (!dealer) return;
    setTier(dealer.tier);
    setEmploymentType(dealer.employment_type);
    setHourlyRate(String(dealer.hourly_rate_vnd ?? ""));
    setBaseRate(String(dealer.base_rate_vnd ?? ""));
    setNotes(dealer.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealer?.id]);

  // ─── Load dealer_scores on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!open || !dealer?.id) return;
    (async () => {
      const { data } = await supabase
        .from("dealer_scores")
        .select("score, total_hours, worked_hours, overridden_score")
        .eq("dealer_id", dealer.id)
        .maybeSingle();
      if (data) {
        setScore((data as any).score ?? null);
        setTotalHours((data as any).total_hours ?? null);
        setEditScore(String((data as any).overridden_score ?? (data as any).score ?? ""));
        setEditWorkedHours(String((data as any).worked_hours ?? ""));
      } else {
        setScore(null);
        setTotalHours(null);
        setEditScore("");
        setEditWorkedHours("");
      }
    })();
  }, [open, dealer?.id]);

  // ─── Computed salary display ───────────────────────────────────────────────
  const hourlyNum = parseFloat(hourlyRate) || 0;
  const computedSalary = isPT && totalHours != null
    ? Math.round(totalHours * hourlyNum)
    : !isPT && baseRate
      ? parseInt(baseRate, 10) || 0
      : 0;

  // ─── [C5b] Validate ALL numeric inputs ─────────────────────────────────────
  function validateForm(): string | null {
    if (hourlyRate !== "") {
      const hr = Number(hourlyRate);
      if (isNaN(hr) || hr < 0) return "Lương giờ không hợp lệ — vui lòng nhập số dương";
    }

    if (!isPT && baseRate !== "") {
      const br = Number(baseRate);
      if (isNaN(br) || br < 0) return "Lương tháng không hợp lệ — vui lòng nhập số dương";
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

    // [C5b] Guard: validate before any DB call — prevents NaN → broken error chain
    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      // 1. Update core dealer fields
      const hourlyRateNum = hourlyRate ? parseInt(hourlyRate, 10) : null;
      const baseRateNum = !isPT && baseRate ? parseInt(baseRate, 10) : null;

      const { error: dealerErr } = await supabase
        .from("dealers")
        .update({
          tier,
          employment_type: employmentType,
          hourly_rate_vnd: hourlyRateNum,
          base_rate_vnd: baseRateNum,
          notes: notes || null,
        })
        .eq("id", dealer.id);

      if (dealerErr) throw dealerErr;

      // 2. Save score & worked_hours overrides to dealer_score_overrides table
      if (editScore !== "" || editWorkedHours !== "") {
        const overrides: Record<string, string | number | null> = {
          dealer_id: dealer.id,
        };
        if (editScore !== "") overrides.score = Number(editScore);
        if (editWorkedHours !== "") overrides.worked_hours = Number(editWorkedHours);

        const { error: scoreErr } = await supabase
          .from("dealer_score_overrides")
          .upsert(overrides, { onConflict: "dealer_id" });

        if (scoreErr) throw scoreErr;
      }

      toast.success("Đã cập nhật thông tin dealer");
      onSaved();
      onClose();
    } catch (e: unknown) {
      // [C5b] Robust error handling — e can be Error, string, or Supabase error object
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
    // [C5c] open prop controls visibility — Dialog stays mounted
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {dealer ? `Điều chỉnh — ${dealer.full_name}` : "Điều chỉnh dealer"}
          </DialogTitle>
        </DialogHeader>

        {dealer && (
          <div className="space-y-3">
            {/* Salary summary */}
            {totalHours != null && computedSalary > 0 && (
              <div className="p-3 bg-emerald-600/10 border border-emerald-600/30 rounded-sm text-sm">
                <span className="text-muted-foreground">Lương hiện tại: </span>
                <span className="text-emerald-400 font-bold">{computedSalary.toLocaleString("vi-VN")} VND</span>
                {isPT && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({totalHours.toFixed(1)}h × {hourlyNum.toLocaleString("vi-VN")}/h)
                  </span>
                )}
              </div>
            )}

            {/* [C6] Điểm + Số giờ — ALWAYS visible, never gated on null */}
            <div className="grid grid-cols-2 gap-3">
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
                  onChange={(e) => setEditWorkedHours(e.target.value)}
                  placeholder="VD: 40"
                  className="text-xs"
                />
              </div>
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

            {/* Giờ/Tháng (VND) */}
            <div>
              <Label className="text-xs">Giờ/Tháng (VND) — {isPT ? "part-time" : "full-time"}</Label>
              <Input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="VD: 100000"
                className="text-xs"
              />
            </div>

            {/* [C5a] Lương tháng — ẩn khi part-time */}
            {!isPT && (
              <div>
                <Label className="text-xs">Lương tháng (VND) — full-time</Label>
                <Input
                  type="number"
                  value={baseRate}
                  onChange={(e) => setBaseRate(e.target.value)}
                  placeholder="VD: 100000"
                  className="text-xs"
                />
              </div>
            )}

            {/* Ghi chú */}
            <div>
              <Label className="text-xs">Ghi chú</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" rows={3} />
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
