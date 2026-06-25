import { useEffect, useState } from "react";
import { Palette, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProofUploader } from "@/components/ProofUploader";

/**
 * Per-club TV-clock branding — a button that opens a dialog to set the club's logo
 * emblem, brand name, and TV background (each club adjusts its own). Reads/writes the
 * clubs row directly (owners/admins already have UPDATE under existing RLS). The clock
 * reads tv_logo_url / tv_brand_name / tv_bg_url (bg falls back to cover_url). Casts to
 * any: the tv_* columns (mig 20261028000000) are not in the generated types yet.
 */
export function TvBrandingEditor({ clubId }: { clubId: string }) {
  const [open, setOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tv_* columns not in generated types yet
      const { data } = await (supabase as any)
        .from("clubs")
        .select("tv_logo_url, tv_brand_name, tv_bg_url")
        .eq("id", clubId)
        .maybeSingle();
      if (cancelled) return;
      setLogoUrl(data?.tv_logo_url ?? null);
      setBgUrl(data?.tv_bg_url ?? null);
      setBrandName(data?.tv_brand_name ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, clubId]);

  const save = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
      const { error } = await (supabase as any)
        .from("clubs")
        .update({ tv_logo_url: logoUrl, tv_brand_name: brandName.trim() || null, tv_bg_url: bgUrl })
        .eq("id", clubId);
      if (error) { toast.error(error.message); return; }
      toast.success("Đã lưu thương hiệu TV — màn hình TV sẽ tự cập nhật.");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10">
          <Palette className="w-4 h-4" /> Chỉnh thương hiệu TV (logo · nền · tên)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-emerald-400" /> Thương hiệu TV (theo câu lạc bộ)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Logo, ảnh nền và tên hiển thị trên đồng hồ TV — mỗi CLB chỉnh riêng. Bỏ trống = mặc định (♠ + tên CLB + “VINPOKER”).
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Đang tải…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Logo CLB (giữa đồng hồ)</Label>
                  <ProofUploader folder="club/tv-logo" value={logoUrl} onChange={setLogoUrl} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Ảnh nền TV (sau đồng hồ)</Label>
                  <ProofUploader folder="club/tv-bg" value={bgUrl} onChange={setBgUrl} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Tên thương hiệu (dưới logo)</Label>
                <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="VD: VINPOKER / tên CLB" maxLength={28} />
              </div>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1">
                <Save className="w-4 h-4" /> {saving ? "Đang lưu…" : "Lưu thương hiệu TV"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
