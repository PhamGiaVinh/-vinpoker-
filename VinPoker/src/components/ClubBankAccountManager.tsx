import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Image as ImageIcon, Save, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compressImage";
import { VN_BANKS } from "@/lib/vietnamBanks";

type Account = {
  id: string;
  bank_name: string;
  bank_bin: string | null;
  account_number: string;
  account_holder: string;
  qr_code_url: string | null;
  notes: string | null;
  is_active: boolean;
  account_type: string;
  club_id: string;
};

interface Props {
  clubId: string;
}

export const ClubBankAccountManager = ({ clubId }: Props) => {
  const [acc, setAcc] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    bank_name: "", bank_bin: null as string | null, account_number: "", account_holder: "",
    qr_code_url: null as string | null, notes: "", is_active: true,
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("platform_bank_accounts")
      .select("*")
      .eq("club_id", clubId)
      .eq("account_type", "escrow")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      setAcc(data as any);
      setForm({
        bank_name: data.bank_name,
        bank_bin: (data as { bank_bin?: string | null }).bank_bin ?? null,
        account_number: data.account_number,
        account_holder: data.account_holder,
        qr_code_url: data.qr_code_url,
        notes: data.notes ?? "",
        is_active: data.is_active,
      });
    } else {
      setAcc(null);
      setForm({ bank_name: "", bank_bin: null, account_number: "", account_holder: "", qr_code_url: null, notes: "", is_active: true });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const uploadQR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(raw.type)) {
      toast.error("Chỉ JPG/PNG/WEBP"); return;
    }
    setUploading(true);
    try {
      const file = await compressImage(raw, { maxEdge: 800, quality: 0.85 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      // First folder MUST be the bare club id: the bank-qr-codes storage RLS policy
      // checks (storage.foldername(name))[1] IN clubs.id::text for owner_id=auth.uid().
      // A "club-" prefix breaks that match → "violates row-level security policy".
      const path = `${clubId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("bank-qr-codes")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("bank-qr-codes").getPublicUrl(path);
      setForm((f) => ({ ...f, qr_code_url: pub.publicUrl }));
      toast.success("Đã tải QR");
    } catch (e: any) {
      toast.error(e.message ?? "Upload lỗi");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    if (!form.bank_name.trim() || !form.account_number.trim() || !form.account_holder.trim()) {
      toast.error("Vui lòng điền đầy đủ tên ngân hàng, số tài khoản và chủ tài khoản"); return;
    }
    setSaving(true);
    const payload = {
      bank_name: form.bank_name.trim(),
      account_number: form.account_number.trim(),
      account_holder: form.account_holder.trim(),
      qr_code_url: form.qr_code_url,
      notes: form.notes || null,
      is_active: form.is_active,
      account_type: "escrow",
      club_id: clubId,
    };
    let savedId = acc?.id;
    let saveErr: { message: string } | null = null;
    if (acc) {
      const { error } = await supabase.from("platform_bank_accounts").update(payload).eq("id", acc.id);
      saveErr = error;
    } else {
      const { data, error } = await supabase.from("platform_bank_accounts").insert(payload).select("id").maybeSingle();
      saveErr = error;
      savedId = (data as { id?: string } | null)?.id;
    }
    if (saveErr) { setSaving(false); toast.error(saveErr.message); return; }
    // bank_bin (VietQR Stage 2) is written SEPARATELY + best-effort so the base account save is
    // unaffected if the bank_bin column hasn't been applied yet (the dynamic QR just falls back to the
    // free-text bank-name map until then). Once the migration is live, re-saving persists the BIN.
    if (savedId) {
      const { error: binErr } = await supabase
        .from("platform_bank_accounts")
        .update({ bank_bin: form.bank_bin || null } as never)
        .eq("id", savedId);
      if (binErr) console.warn("bank_bin not saved (Stage-2 column may be unapplied):", binErr.message);
    }
    setSaving(false);
    toast.success(acc ? "Đã cập nhật" : "Đã tạo tài khoản");
    load();
  };

  if (loading) return <Card className="p-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></Card>;

  const knownBins = new Set(VN_BANKS.map((b) => b.bin));
  const bankSelectValue = form.bank_bin && knownBins.has(form.bank_bin) ? form.bank_bin : "other";

  return (
    <Card className="p-4 space-y-3 border-primary/30">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-primary" />
        <h3 className="font-display text-primary">Tài khoản ngân hàng & QR thanh toán</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Áp dụng cho: <b>đăng ký giải</b> & <b>stake</b>. Player sẽ chuyển khoản trực tiếp vào tài khoản này của CLB.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Ngân hàng *</Label>
          <Select
            value={bankSelectValue}
            onValueChange={(v) => {
              if (v === "other") { setForm({ ...form, bank_bin: null }); return; }
              const b = VN_BANKS.find((x) => x.bin === v);
              if (b) setForm({ ...form, bank_name: b.shortName, bank_bin: b.bin });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Chọn ngân hàng" /></SelectTrigger>
            <SelectContent>
              {VN_BANKS.map((b) => (
                <SelectItem key={b.bin} value={b.bin}>{b.shortName} · {b.bin}</SelectItem>
              ))}
              <SelectItem value="other">Khác (tự nhập)</SelectItem>
            </SelectContent>
          </Select>
          {bankSelectValue === "other" && (
            <Input className="mt-2" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="VD: Vietcombank" />
          )}
          {bankSelectValue !== "other" && (
            <p className="text-[10px] text-muted-foreground mt-1">Mã QR VietQR động sẽ dùng mã ngân hàng này.</p>
          )}
        </div>
        <div>
          <Label>Số tài khoản *</Label>
          <Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Chủ tài khoản *</Label>
          <Input value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Ghi chú (không bắt buộc)</Label>
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>

      <div>
        <Label>QR thanh toán</Label>
        <div className="flex items-center gap-3 mt-1">
          {form.qr_code_url
            ? <img src={form.qr_code_url} alt="qr" className="w-24 h-24 rounded border border-border object-cover" />
            : <div className="w-24 h-24 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><ImageIcon className="w-6 h-6" /></div>}
          <input id={`qr-up-${clubId}`} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={uploadQR} />
          <Button asChild size="sm" variant="outline" disabled={uploading}>
            <label htmlFor={`qr-up-${clubId}`} className="cursor-pointer">
              {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5 mr-1" />}
              {form.qr_code_url ? "Thay QR" : "Tải QR"}
            </label>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label>Đang hoạt động</Label>
        <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gradient-neon text-primary-foreground">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Lưu
        </Button>
      </div>
    </Card>
  );
};
