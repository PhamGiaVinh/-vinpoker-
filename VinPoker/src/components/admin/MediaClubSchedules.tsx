import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, CalendarDays } from "lucide-react";
import { toast } from "sonner";

interface ClubRow {
  id: string;
  name: string;
  region: string;
  daily_schedule_image_url: string | null;
  weekly_schedule_image_url: string | null;
}

export const MediaClubSchedules = () => {
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("clubs")
      .select("id,name,region,daily_schedule_image_url,weekly_schedule_image_url")
      .eq("status", "approved")
      .order("name");
    if (error) toast.error(error.message);
    setClubs((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const upload = async (clubId: string, kind: "daily" | "weekly", file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Phải là file ảnh");
    if (file.size > 8 * 1024 * 1024) return toast.error("Ảnh tối đa 8MB");
    setBusyId(clubId + kind);
    const ext = file.name.split(".").pop();
    const path = `schedules/${clubId}/${kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (upErr) { setBusyId(null); return toast.error(upErr.message); }
    const { data: pub } = supabase.storage.from("app-assets").getPublicUrl(path);
    const col = kind === "daily" ? "daily_schedule_image_url" : "weekly_schedule_image_url";
    const payload: any = { [col]: pub.publicUrl };
    const { error } = await supabase.from("clubs").update(payload).eq("id", clubId);
    setBusyId(null);
    if (error) toast.error(error.message);
    else { toast.success("Đã cập nhật lịch"); load(); }
  };

  const clear = async (clubId: string, kind: "daily" | "weekly") => {
    if (!confirm("Xoá ảnh lịch này?")) return;
    const col = kind === "daily" ? "daily_schedule_image_url" : "weekly_schedule_image_url";
    const clearPayload: any = { [col]: null };
    const { error } = await supabase.from("clubs").update(clearPayload).eq("id", clubId);
    if (error) toast.error(error.message);
    else { toast.success("Đã xoá"); load(); }
  };

  const filtered = clubs.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.region.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-primary" />
        <h2 className="font-display font-bold text-lg">Lịch thi đấu CLB</h2>
      </div>
      <Input placeholder="Tìm CLB theo tên / khu vực..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="grid gap-3">
        {filtered.map(c => (
          <Card key={c.id} className="p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-display font-bold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.region}</div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {(["weekly", "daily"] as const).map(kind => {
                const url = kind === "daily" ? c.daily_schedule_image_url : c.weekly_schedule_image_url;
                const label = kind === "daily" ? "Lịch hàng ngày" : "Lịch hàng tuần";
                const busy = busyId === c.id + kind;
                return (
                  <div key={kind} className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-primary">{label}</div>
                    {url ? (
                      <div className="relative">
                        <img src={url} alt={`${c.name} ${kind}`} className="w-full h-40 object-contain rounded border border-border bg-muted/30" />
                      </div>
                    ) : (
                      <div className="h-40 rounded border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">Chưa có ảnh</div>
                    )}
                    <div className="flex gap-2">
                      <label className="flex-1">
                        <input type="file" accept="image/*" className="hidden" disabled={busy}
                          onChange={e => { const f = e.target.files?.[0]; if (f) upload(c.id, kind, f); e.currentTarget.value = ""; }} />
                        <span className="inline-flex items-center justify-center gap-1 w-full text-xs px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/30 cursor-pointer hover:bg-primary/20">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          Tải ảnh
                        </span>
                      </label>
                      {url && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => clear(c.id, kind)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
