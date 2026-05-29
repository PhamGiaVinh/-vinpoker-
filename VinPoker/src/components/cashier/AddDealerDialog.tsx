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
  const [baseRate, setBaseRate] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFullName("");
    setTier("C");
    setEmploymentType("full_time");
    setHourlyRate("");
    setBaseRate("");
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
      const { error } = await supabase.from("dealers").insert({
        club_id: clubId,
        full_name: fullName.trim(),
        tier,
        employment_type: employmentType,
        hourly_rate_vnd: hourlyRate ? parseInt(hourlyRate, 10) : null,
        base_rate_vnd: baseRate ? parseInt(baseRate, 10) : null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#0A0A0A] border border-zinc-800 text-white">
        <DialogHeader>
          <DialogTitle>Thêm Dealer Mới</DialogTitle>
          <DialogDescription className="text-zinc-400">
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
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Hạng</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectItem value="A">A — Cao cấp</SelectItem>
                  <SelectItem value="B">B — Trung cấp</SelectItem>
                  <SelectItem value="C">C — Cơ bản</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Loại</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Lương giờ (VND)</Label>
              <Input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="50000"
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>
            <div>
              <Label>Lương cơ bản (VND)</Label>
              <Input
                type="number"
                value={baseRate}
                onChange={(e) => setBaseRate(e.target.value)}
                placeholder="8000000"
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>
          </div>
          <div>
            <Label>Số điện thoại</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="090xxxxxxx"
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>
          <div>
            <Label>Ghi chú</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => { reset(); onOpenChange(false); }}
              className="border-zinc-700 text-zinc-300"
            >
              Hủy
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !fullName.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {saving ? "Đang lưu..." : "Thêm dealer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
