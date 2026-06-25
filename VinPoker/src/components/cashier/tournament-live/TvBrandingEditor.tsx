import { useEffect, useState } from "react";
import { Palette, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProofUploader } from "@/components/ProofUploader";

/**
 * Per-club TV-clock branding: logo emblem + brand name + TV background — each club
 * adjusts its own. Reads/writes the clubs row directly (owners/admins already have
 * UPDATE under the existing RLS, like the media-center cover/schedule editors). The
 * broadcast clock reads tv_logo_url / tv_brand_name / tv_bg_url (bg falls back to
 * cover_url). Casts to any: these columns are not in the generated types yet.
 */
export function TvBrandingEditor({ clubId }: { clubId: string }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tv_* columns not in generated types yet (mig 20261028000000)
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
  }, [clubId]);

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
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Palette className="w-4 h-4 text-emerald-400" />
        Thương hiệu TV (theo câu lạc bộ)
      </div>
      <p className="text-xs text-muted-foreground">
        Logo, ảnh nền và tên hiển thị trên đồng hồ TV — mỗi CLB chỉnh riêng. Bỏ trống = dùng mặc định (♠ + tên CLB + “VINPOKER”).
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
    </Card>
  );
}
