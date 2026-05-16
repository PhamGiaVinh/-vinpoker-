import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Radio, Pencil, Upload, X } from "lucide-react";
import { validateStreamUrl, type StreamPlatform } from "@/lib/streamUrl";
import { compressImage } from "@/lib/compressImage";

const CUSTOM_TOUR_VALUE = "__custom__";

interface Stream {
  id: string;
  tournament_id: string | null;
  platform: StreamPlatform;
  stream_url: string;
  embed_id: string | null;
  title: string | null;
  is_live: boolean;
  match_title: string | null;
  scheduled_at: string | null;
  thumbnail_url: string | null;
  custom_tournament_name: string | null;
}

interface Tour { id: string; name: string; club_id: string | null; current_players?: number | null; }
interface Club { id: string; name: string; }

const ThumbnailPicker = ({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) => {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !user) return;
    if (!raw.type.startsWith("image/")) { toast.error("Chỉ chấp nhận ảnh"); return; }
    if (raw.size > 5 * 1024 * 1024) { toast.error("Tối đa 5MB"); return; }
    setUp(true);
    const file = await compressImage(raw, { maxEdge: 1280, quality: 0.8 });
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `${user.id}/stream-thumbs/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setUp(false); toast.error(error.message); return; }
    const { data } = supabase.storage.from("app-assets").getPublicUrl(path);
    onChange(data.publicUrl);
    setUp(false);
  };
  return (
    <div>
      <input ref={inputRef} hidden type="file" accept="image/*" onChange={handle} />
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="thumb" className="h-20 w-32 object-cover rounded border border-border" />
          <button type="button" onClick={() => onChange(null)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={up}>
          {up ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
          Chọn ảnh thumbnail
        </Button>
      )}
    </div>
  );
};

export const AdminStreamManager = () => {
  const { user } = useAuth();
  const [tours, setTours] = useState<Tour[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);

  // add form
  const [tourId, setTourId] = useState("");
  const [customTour, setCustomTour] = useState("");
  const [platform, setPlatform] = useState<StreamPlatform>("youtube");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [matchTitle, setMatchTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // edit dialog
  const [editing, setEditing] = useState<Stream | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eUrl, setEUrl] = useState("");
  const [ePlatform, setEPlatform] = useState<StreamPlatform>("youtube");
  const [eLive, setELive] = useState(true);
  const [eMatch, setEMatch] = useState("");
  const [eSched, setESched] = useState("");
  const [eThumb, setEThumb] = useState<string | null>(null);
  const [eTour, setETour] = useState("");
  const [eCustom, setECustom] = useState("");
  const [eSaving, setESaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: t }, { data: c }, { data: s }] = await Promise.all([
      supabase.from("tournaments").select("id,name,club_id,current_players").order("start_time", { ascending: false }).limit(500),
      supabase.from("clubs").select("id,name"),
      supabase.from("tournament_streams").select("*").order("created_at", { ascending: false }),
    ]);
    setTours((t ?? []) as Tour[]);
    setClubs((c ?? []) as Club[]);
    setStreams((s ?? []) as Stream[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const tourMap = Object.fromEntries(tours.map((t) => [t.id, t]));
  const clubMap = Object.fromEntries(clubs.map((c) => [c.id, c.name]));

  const resetForm = () => {
    setTourId(""); setCustomTour(""); setUrl(""); setTitle("");
    setMatchTitle(""); setScheduledAt(""); setThumb(null);
  };

  const add = async () => {
    if (!user) return;
    const isCustom = tourId === CUSTOM_TOUR_VALUE;
    if (!tourId) { toast.error("Hãy chọn giải đấu"); return; }
    if (isCustom && !customTour.trim()) { toast.error("Nhập tên giải tùy chỉnh"); return; }
    const v = validateStreamUrl(platform, url);
    if (!v.ok) { toast.error(v.error!); return; }
    setSaving(true);
    const { error } = await supabase.from("tournament_streams").insert({
      tournament_id: isCustom ? null : tourId,
      custom_tournament_name: isCustom ? customTour.trim() : null,
      platform, stream_url: url.trim(),
      embed_id: v.embedId ?? null,
      title: title.trim() || null,
      match_title: matchTitle.trim() || null,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      thumbnail_url: thumb,
      is_live: true, created_by: user.id,
    });
    setSaving(false);
    if (error) { toast.error("Không thể lưu: " + error.message); return; }
    toast.success("Đã thêm stream"); resetForm(); load();
  };

  const openEdit = (s: Stream) => {
    setEditing(s);
    setETitle(s.title ?? ""); setEUrl(s.stream_url);
    setEPlatform(s.platform); setELive(s.is_live);
    setEMatch(s.match_title ?? "");
    setESched(s.scheduled_at ? new Date(s.scheduled_at).toISOString().slice(0, 16) : "");
    setEThumb(s.thumbnail_url);
    setETour(s.tournament_id ?? (s.custom_tournament_name ? CUSTOM_TOUR_VALUE : ""));
    setECustom(s.custom_tournament_name ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    const v = validateStreamUrl(ePlatform, eUrl);
    if (!v.ok) { toast.error(v.error!); return; }
    const isCustom = eTour === CUSTOM_TOUR_VALUE;
    if (isCustom && !eCustom.trim()) { toast.error("Nhập tên giải tùy chỉnh"); return; }
    setESaving(true);
    const { error } = await supabase.from("tournament_streams").update({
      title: eTitle.trim() || null,
      stream_url: eUrl.trim(),
      platform: ePlatform,
      embed_id: v.embedId ?? null,
      is_live: eLive,
      match_title: eMatch.trim() || null,
      scheduled_at: eSched ? new Date(eSched).toISOString() : null,
      thumbnail_url: eThumb,
      tournament_id: isCustom ? null : (eTour || null),
      custom_tournament_name: isCustom ? eCustom.trim() : null,
    }).eq("id", editing.id);
    setESaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã cập nhật"); setEditing(null); load();
  };

  const toggleLive = async (s: Stream) => {
    const { error } = await supabase.from("tournament_streams").update({ is_live: !s.is_live }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    setStreams((prev) => prev.map((x) => x.id === s.id ? { ...x, is_live: !s.is_live } : x));
  };

  const remove = async (s: Stream) => {
    if (!confirm("Xoá stream này?")) return;
    const { error } = await supabase.from("tournament_streams").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    setStreams((prev) => prev.filter((x) => x.id !== s.id));
  };

  const updatePlayers = async (tourId: string) => {
    const v = prompt("Số người chơi hiện tại:");
    if (v === null) return;
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0) { toast.error("Số không hợp lệ"); return; }
    const { error } = await supabase.from("tournaments").update({ current_players: n }).eq("id", tourId);
    if (error) { toast.error(error.message); return; }
    setTours((prev) => prev.map((t) => t.id === tourId ? { ...t, current_players: n } as any : t));
    toast.success("Đã cập nhật số người chơi");
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-display font-bold flex items-center gap-2"><Radio className="w-4 h-4 text-gold" /> Thêm stream mới</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Chọn giải đấu</Label>
            <Select value={tourId} onValueChange={setTourId}>
              <SelectTrigger><SelectValue placeholder="-- Chọn giải đấu --" /></SelectTrigger>
              <SelectContent>
                {tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.club_id ? ` · ${clubMap[t.club_id] ?? ""}` : ""}</SelectItem>)}
                <SelectItem value={CUSTOM_TOUR_VALUE}>Khác / Tùy chỉnh</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tourId === CUSTOM_TOUR_VALUE && (
            <div>
              <Label className="text-xs">Tên giải tùy chỉnh</Label>
              <Input value={customTour} onChange={(e) => setCustomTour(e.target.value)} placeholder="Nhập tên giải đấu..." />
            </div>
          )}
          <div className="md:col-span-2">
            <Label className="text-xs">Tên trận đấu</Label>
            <Input value={matchTitle} onChange={(e) => setMatchTitle(e.target.value)} placeholder="VD: Team A vs Team B" />
          </div>
          <div>
            <Label className="text-xs">Nền tảng phát sóng</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as StreamPlatform)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Ngày phát sóng</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Link phát sóng</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={platform === "youtube" ? "https://youtube.com/watch?v=..." : "https://facebook.com/.../videos/..."} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Tiêu đề (tuỳ chọn)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Final Table Day 3" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Hình thumbnail</Label>
            <ThumbnailPicker value={thumb} onChange={setThumb} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={add} disabled={saving} className="gradient-gold text-primary-foreground border-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Lưu Stream</>}
          </Button>
          <Button variant="ghost" onClick={resetForm} disabled={saving}>Hủy</Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-display font-bold mb-3">Tất cả streams</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
        ) : streams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có stream nào.</p>
        ) : (
          <div className="space-y-2">
            {streams.map((s) => {
              const t = s.tournament_id ? tourMap[s.tournament_id] : null;
              const tourName = t?.name ?? s.custom_tournament_name ?? "?";
              return (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
                  {s.thumbnail_url && <img src={s.thumbnail_url} alt="" className="h-12 w-20 object-cover rounded shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{s.platform}</span>
                      <span className="text-sm font-semibold truncate">{tourName}</span>
                      {t?.club_id && <span className="text-xs text-muted-foreground">· {clubMap[t.club_id] ?? ""}</span>}
                      {s.is_live && <span className="text-[10px] font-bold text-red-500">● LIVE</span>}
                    </div>
                    {s.match_title && <div className="text-xs text-foreground/90">{s.match_title}</div>}
                    {s.title && <div className="text-xs text-foreground/70">{s.title}</div>}
                    {s.scheduled_at && <div className="text-[11px] text-muted-foreground">{new Date(s.scheduled_at).toLocaleString("vi-VN")}</div>}
                    {t && (
                      <button
                        onClick={() => updatePlayers(t.id)}
                        className="text-[11px] text-gold hover:underline mt-0.5 block"
                      >
                        👥 {t.current_players ?? 0} người chơi · sửa
                      </button>
                    )}
                    <a href={s.stream_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground truncate block hover:text-primary">{s.stream_url}</a>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={s.is_live} onCheckedChange={() => toggleLive(s)} />
                    <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(s)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Chỉnh sửa stream</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Giải đấu</Label>
              <Select value={eTour} onValueChange={setETour}>
                <SelectTrigger><SelectValue placeholder="-- Chọn --" /></SelectTrigger>
                <SelectContent>
                  {tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  <SelectItem value={CUSTOM_TOUR_VALUE}>Khác / Tùy chỉnh</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {eTour === CUSTOM_TOUR_VALUE && (
              <div>
                <Label className="text-xs">Tên giải tùy chỉnh</Label>
                <Input value={eCustom} onChange={(e) => setECustom(e.target.value)} />
              </div>
            )}
            <div>
              <Label className="text-xs">Tên trận đấu</Label>
              <Input value={eMatch} onChange={(e) => setEMatch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Tiêu đề</Label>
              <Input value={eTitle} onChange={(e) => setETitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Nền tảng</Label>
              <Select value={ePlatform} onValueChange={(v) => setEPlatform(v as StreamPlatform)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Ngày phát sóng</Label>
              <Input type="datetime-local" value={eSched} onChange={(e) => setESched(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Link phát sóng</Label>
              <Input value={eUrl} onChange={(e) => setEUrl(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Thumbnail</Label>
              <ThumbnailPicker value={eThumb} onChange={setEThumb} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={eLive} onCheckedChange={setELive} />
              <span className="text-sm">Đang LIVE</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Huỷ</Button>
            <Button onClick={saveEdit} disabled={eSaving} className="gradient-gold text-primary-foreground border-0">
              {eSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
