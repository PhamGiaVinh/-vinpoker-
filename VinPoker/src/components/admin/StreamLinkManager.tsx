import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Radio } from "lucide-react";
import { validateStreamUrl, type StreamPlatform } from "@/lib/streamUrl";

interface Stream {
  id: string;
  tournament_id: string;
  platform: StreamPlatform;
  stream_url: string;
  title: string | null;
  is_live: boolean;
}

interface Tour { id: string; name: string; }

export const StreamLinkManager = ({ clubId }: { clubId: string }) => {
  const { user } = useAuth();
  const [tours, setTours] = useState<Tour[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [tourId, setTourId] = useState<string>("");
  const [platform, setPlatform] = useState<StreamPlatform>("youtube");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: t } = await supabase.from("tournaments").select("id,name").eq("club_id", clubId).order("start_time", { ascending: false });
    setTours((t ?? []) as Tour[]);
    const ids = (t ?? []).map((x: any) => x.id);
    if (ids.length) {
      const { data: s } = await supabase.from("tournament_streams").select("*").in("tournament_id", ids).order("created_at", { ascending: false });
      setStreams((s ?? []) as Stream[]);
    } else setStreams([]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const add = async () => {
    if (!user || !tourId) { toast.error("Hãy chọn giải đấu"); return; }
    const v = validateStreamUrl(platform, url);
    if (!v.ok) { toast.error(v.error!); return; }
    setSaving(true);
    const { error } = await supabase.from("tournament_streams").insert({
      tournament_id: tourId,
      platform,
      stream_url: url.trim(),
      embed_id: v.embedId ?? null,
      title: title.trim() || null,
      is_live: true,
      created_by: user.id,
    });
    setSaving(false);
    if (error) { toast.error("Không thể lưu: " + error.message); return; }
    toast.success("Đã thêm stream");
    setUrl(""); setTitle("");
    load();
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

  const tourMap = Object.fromEntries(tours.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-display font-bold flex items-center gap-2"><Radio className="w-4 h-4 text-gold" /> Thêm stream mới</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Giải đấu</Label>
            <Select value={tourId} onValueChange={setTourId}>
              <SelectTrigger><SelectValue placeholder="Chọn giải" /></SelectTrigger>
              <SelectContent>
                {tours.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Nền tảng</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as StreamPlatform)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Link phát sóng</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={platform === "youtube" ? "https://youtube.com/watch?v=..." : "https://facebook.com/.../videos/..."}
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Tiêu đề (tuỳ chọn)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Final Table Day 3" />
          </div>
        </div>
        <Button onClick={add} disabled={saving} className="gradient-gold text-primary-foreground border-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Thêm</>}
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="font-display font-bold mb-3">Streams hiện có</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
        ) : streams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có stream nào.</p>
        ) : (
          <div className="space-y-2">
            {streams.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{s.platform}</span>
                    <span className="text-sm font-semibold truncate">{tourMap[s.tournament_id] ?? "?"}</span>
                    {s.is_live && <span className="text-[10px] font-bold text-red-500">● LIVE</span>}
                  </div>
                  <a href={s.stream_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground truncate block hover:text-primary">{s.stream_url}</a>
                  {s.title && <div className="text-xs text-muted-foreground italic">{s.title}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={s.is_live} onCheckedChange={() => toggleLive(s)} />
                  <Button size="icon" variant="ghost" onClick={() => remove(s)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
