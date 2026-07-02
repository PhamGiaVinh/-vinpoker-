import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { mapFnbError } from "@/lib/fnbErrors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, TrendingUp, QrCode } from "lucide-react";

type FnbSettings = {
  pending_ttl_secs: number;
  restock_on_shipped_cancel: boolean;
  fnb_in_club_net: boolean;
  guest_order_enabled?: boolean;
  guest_bank_auto_confirm?: boolean;
  guest_bank_ttl_secs?: number;
};

const DEFAULTS: FnbSettings = { pending_ttl_secs: 900, restock_on_shipped_cancel: false, fnb_in_club_net: false };

export function FnbSettingsPanel({ clubId }: { clubId: string }) {
  const [ttlMinutes, setTtlMinutes] = useState("15");
  const [restock, setRestock] = useState(false);
  const [inClubNet, setInClubNet] = useState(false);
  const [guestEnabled, setGuestEnabled] = useState(false);
  const [guestBankAuto, setGuestBankAuto] = useState(false);
  const [guestBankMinutes, setGuestBankMinutes] = useState("30");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("fnb_settings").select("*").eq("club_id", clubId).maybeSingle();
    const s: FnbSettings = data ?? DEFAULTS;
    setTtlMinutes(String(Math.max(1, Math.round((s.pending_ttl_secs ?? 900) / 60))));
    setRestock(!!s.restock_on_shipped_cancel);
    setInClubNet(!!s.fnb_in_club_net);
    setGuestEnabled(!!s.guest_order_enabled);
    setGuestBankAuto(!!s.guest_bank_auto_confirm);
    setGuestBankMinutes(String(Math.max(1, Math.round((s.guest_bank_ttl_secs ?? 1800) / 60))));
    setLoading(false);
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const mins = Math.max(1, Math.floor(Number(ttlMinutes) || 15));
    const bankMins = Math.max(1, Math.floor(Number(guestBankMinutes) || 30));
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("fnb_update_settings", {
      p_club_id: clubId,
      p_pending_ttl_secs: mins * 60,
      p_restock_on_shipped_cancel: restock,
      p_fnb_in_club_net: inClubNet,
      // GQR guest-ordering settings (7-arg fnb_update_settings, migration …0017). Only sent when the
      // flag is on; a club on the pre-…0017 DB would reject unknown args, so keep them out otherwise.
      ...(FEATURES.fnbGuestOrder ? {
        p_guest_order_enabled: guestEnabled,
        p_guest_bank_auto_confirm: guestBankAuto,
        p_guest_bank_ttl_secs: bankMins * 60,
      } : {}),
    });
    setSaving(false);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success("Đã lưu cài đặt.");
    load();
  };

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang tải…
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-base">Cài đặt F&amp;B</h3>
        <p className="text-xs text-muted-foreground">Quy tắc vận hành cho câu lạc bộ này.</p>
      </div>

      <div className="max-w-xs">
        <Label htmlFor="ttl">Tự huỷ đơn chưa thanh toán sau (phút)</Label>
        <Input id="ttl" type="number" min={1} value={ttlMinutes}
          onChange={(e) => setTtlMinutes(e.target.value)} className="bg-card border-border text-foreground" />
        <p className="mt-1 text-[11px] text-muted-foreground">Đơn “chờ thanh toán” quá hạn này sẽ tự chuyển thành “hết hạn”.</p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3">
        <div>
          <Label htmlFor="restock" className="cursor-pointer">Hoàn kho khi huỷ đơn ĐÃ bưng</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Mặc định TẮT: món đã bưng coi như đã dùng nguyên liệu → huỷ chỉ hoàn tiền, không hoàn kho.</p>
        </div>
        <Switch id="restock" checked={restock} onCheckedChange={setRestock} />
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
        <div>
          <Label htmlFor="net" className="cursor-pointer flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-primary" /> Tính F&amp;B vào Lãi ròng của CLB
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Bật để dòng <span className="font-medium">doanh thu &amp; giá vốn F&amp;B</span> xuất hiện trong Dashboard Tài chính CLB
            (Net += doanh thu − giá vốn). Chỉ bật sau khi đã chạy thử (UAT).
          </p>
        </div>
        <Switch id="net" checked={inClubNet} onCheckedChange={setInClubNet} />
      </div>

      {FEATURES.fnbGuestOrder && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="guest" className="cursor-pointer flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-primary" /> Cho khách gọi món qua QR
              </Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Bật để mã QR trên bàn hoạt động (khách quét → gọi món). Cần đã tạo mã ở tab “QR bàn”.</p>
            </div>
            <Switch id="guest" checked={guestEnabled} onCheckedChange={setGuestEnabled} />
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-border/50 pt-3">
            <div>
              <Label htmlFor="bankauto" className="cursor-pointer">Tự động xác nhận chuyển khoản (SePay)</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Khách chuyển khoản VietQR → hệ thống tự xác nhận (0–6 phút). Cần đã cấu hình SePay cho CLB.</p>
            </div>
            <Switch id="bankauto" checked={guestBankAuto} onCheckedChange={setGuestBankAuto} />
          </div>
          <div className="max-w-xs border-t border-border/50 pt-3">
            <Label htmlFor="bankttl">Giữ đơn chuyển khoản chờ thanh toán (phút)</Label>
            <Input id="bankttl" type="number" min={1} value={guestBankMinutes}
              onChange={(e) => setGuestBankMinutes(e.target.value)} className="bg-card border-border text-foreground" />
            <p className="mt-1 text-[11px] text-muted-foreground">Đơn chuyển khoản chờ quá lâu sẽ tự huỷ (mặc định 30 phút).</p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-success hover:bg-success/90 text-success-foreground">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
          Lưu cài đặt
        </Button>
      </div>
    </Card>
  );
}
