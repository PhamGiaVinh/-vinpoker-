import { useEffect, useMemo, useState } from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProofUploader } from "@/components/ProofUploader";
import { FEATURES } from "@/lib/featureFlags";
import {
  DEFAULT_TV_BRANDING_LAYOUT,
  TV_BRANDING_FONT_STACKS,
  TV_BRANDING_FONTS,
  parseTvBrandingLayout,
  serializeTvBrandingLayout,
  type TvBrandingFont,
  type TvBrandingLayout,
} from "@/lib/tv/brandingLayout";

type UntypedRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;
const rpc = supabase.rpc.bind(supabase) as UntypedRpc;

function RangeControl({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="min-w-12 text-right font-mono text-xs text-muted-foreground">{value}%</span>
      </div>
      <Slider aria-label={label} min={min} max={max} step={1} value={[value]} onValueChange={([next]) => onChange(next)} />
    </div>
  );
}

export function TvBrandingEditor({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [layout, setLayout] = useState<TvBrandingLayout>({ ...DEFAULT_TV_BRANDING_LAYOUT });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!FEATURES.tvLayoutEditorV1) return;
    let active = true;
    setCanEdit(false);
    void rpc("can_edit_tv_tournament_layout_v1", { p_tournament_id: tournamentId }).then(({ data, error }) => {
      if (active) setCanEdit(!error && data === true);
    });
    return () => { active = false; };
  }, [tournamentId]);

  useEffect(() => {
    if (!open || !FEATURES.tvLayoutEditorV1) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const { data, error } = await rpc("get_tv_tournament_branding_v1", { p_tournament_id: tournamentId });
      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message ?? "Tournament TV settings were not found.");
        setLoading(false);
        return;
      }
      const row = data as unknown as {
        logo_url: string | null;
        brand_name: string | null;
        background_url: string | null;
        layout: unknown;
        revision: number;
      };
      setLogoUrl(row.logo_url);
      setBgUrl(row.background_url);
      setBrandName(row.brand_name ?? "");
      setLayout(parseTvBrandingLayout(row.layout));
      setRevision(row.revision);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tournamentId]);

  const previewStyle = useMemo(() => ({
    backgroundImage: bgUrl
      ? `linear-gradient(rgba(0,0,0,.56), rgba(0,0,0,.72)), url("${bgUrl}")`
      : "radial-gradient(circle at 50% 45%, #143522, #03100a 62%)",
    backgroundPosition: `${layout.backgroundX}% ${layout.backgroundY}%`,
    backgroundSize: "cover",
  }), [bgUrl, layout.backgroundX, layout.backgroundY]);

  const patchLayout = <K extends keyof TvBrandingLayout>(key: K, value: TvBrandingLayout[K]) => {
    setLayout((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await rpc("save_tv_tournament_layout_v1", {
        p_tournament_id: tournamentId,
        p_expected_revision: revision,
        p_brand_name: brandName.trim(),
        p_logo_url: logoUrl?.trim() ?? "",
        p_bg_url: bgUrl?.trim() ?? "",
        p_layout: serializeTvBrandingLayout(layout),
      });
      if (error || !data) {
        toast.error(error?.message?.includes("tv_layout_stale_revision")
          ? "Another operator published a new layout. Reopen the editor before saving."
          : error?.message ?? "The TV layout was not saved.");
        return;
      }
      toast.success("TV layout published. Screens update on their next refresh.");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!FEATURES.tvLayoutEditorV1 || !canEdit) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10">
          <Palette className="h-4 w-4" /> Edit TV layout
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2"><Palette className="h-4 w-4 text-emerald-400" /> Tournament TV layout</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Loading TV settings…</p>
        ) : loadError ? (
          <div className="space-y-3 px-5 py-8 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            <p className="text-xs text-muted-foreground">Editing is blocked until the current server settings can be loaded.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
            <section className="border-b bg-black/95 p-4 lg:border-b-0 lg:border-r">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[.18em] text-white/60">
                <span>Live 16:9 preview</span><span>Safe area: 8–92%</span>
              </div>
              <div className="relative aspect-video overflow-hidden rounded-xl border border-emerald-400/30 shadow-2xl" style={previewStyle}>
                <div className="absolute inset-3 rounded-lg border border-emerald-400/30" />
                <div className="absolute left-1/2 top-[6%] w-[55%] -translate-x-1/2 truncate text-center text-[clamp(12px,2vw,28px)] font-black uppercase tracking-wider text-emerald-100">MAIN EVENT · DAY 1</div>
                <div className="absolute left-[34%] top-[33%] grid h-[38%] w-[32%] place-items-center rounded-full border-4 border-emerald-300/70 bg-black/70 text-[clamp(24px,5vw,64px)] font-black text-white shadow-[0_0_32px_rgba(98,255,143,.35)]">35:31</div>
                <div className="absolute bottom-[8%] left-[29%] right-[29%] h-[10%] rounded-lg border border-emerald-400/35 bg-black/65" />
                <div
                  className="absolute grid justify-items-center gap-1 text-center"
                  style={{
                    left: `${layout.brandX}%`, top: `${layout.brandY}%`,
                    transform: `translate(-50%, -50%) scale(${layout.brandScale / 100})`,
                    fontFamily: TV_BRANDING_FONT_STACKS[layout.font],
                  }}
                >
                  <div className="grid place-items-center overflow-hidden rounded-full border-2 border-emerald-200/70 bg-emerald-950 shadow-[0_0_20px_rgba(98,255,143,.6)]" style={{ width: `${44 * layout.logoScale / 100}px`, height: `${44 * layout.logoScale / 100}px` }}>
                    {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl text-emerald-100">♠</span>}
                  </div>
                  <div className="max-w-40 truncate text-sm font-black uppercase tracking-wider text-emerald-50">{brandName.trim() || "VINPOKER"}</div>
                  {layout.customText ? <div className="max-w-44 text-[9px] font-bold text-emerald-300">{layout.customText}</div> : null}
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/55">The preview changes presentation only. Tournament numbers remain server-controlled.</p>
            </section>

            <section className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="space-y-1.5"><Label className="text-xs">Tournament logo</Label><ProofUploader folder="tv/branding-logo" value={logoUrl} onChange={setLogoUrl} /></div>
                <div className="space-y-1.5"><Label className="text-xs">TV background</Label><ProofUploader folder="tv/branding-background" value={bgUrl} onChange={setBgUrl} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="tv-brand-name" className="text-xs">Brand name</Label><Input id="tv-brand-name" value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={40} placeholder="VINPOKER" /></div>
                <div className="space-y-1.5"><Label htmlFor="tv-custom-text" className="text-xs">Custom line</Label><Input id="tv-custom-text" value={layout.customText} onChange={(event) => patchLayout("customText", event.target.value.slice(0, 80))} maxLength={80} placeholder="Final Table · Live" /></div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Brand font</Label>
                <Select value={layout.font} onValueChange={(value) => patchLayout("font", value as TvBrandingFont)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TV_BRANDING_FONTS.map((font) => <SelectItem key={font} value={font}>{font[0].toUpperCase() + font.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <RangeControl label="Brand horizontal" value={layout.brandX} min={8} max={92} onChange={(value) => patchLayout("brandX", value)} />
                <RangeControl label="Brand vertical" value={layout.brandY} min={15} max={85} onChange={(value) => patchLayout("brandY", value)} />
                <RangeControl label="Brand size" value={layout.brandScale} min={70} max={140} onChange={(value) => patchLayout("brandScale", value)} />
                <RangeControl label="Logo size" value={layout.logoScale} min={60} max={150} onChange={(value) => patchLayout("logoScale", value)} />
                <RangeControl label="Background horizontal" value={layout.backgroundX} min={0} max={100} onChange={(value) => patchLayout("backgroundX", value)} />
                <RangeControl label="Background vertical" value={layout.backgroundY} min={0} max={100} onChange={(value) => patchLayout("backgroundY", value)} />
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="border-t px-5 py-4 sm:justify-between">
          <Button type="button" variant="ghost" className="gap-2" disabled={loading || !!loadError || saving} onClick={() => { setLayout({ ...DEFAULT_TV_BRANDING_LAYOUT }); setLogoUrl(null); setBgUrl(null); setBrandName(""); }}><RotateCcw className="h-4 w-4" /> Restore defaults</Button>
          <Button type="button" className="gap-2" onClick={save} disabled={loading || !!loadError || saving}><Save className="h-4 w-4" /> {saving ? "Publishing…" : "Publish TV layout"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
