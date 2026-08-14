import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Radio, Trash2 } from "lucide-react";
import { validateStreamUrl, type StreamPlatform } from "@/lib/streamUrl";

interface Stream {
  id: string;
  tournament_id: string | null;
  custom_tournament_name: string | null;
  platform: StreamPlatform;
  stream_url: string;
  title: string | null;
  is_live: boolean;
  created_at: string;
}

interface Tour {
  id: string;
  name: string;
}

const CUSTOM_STREAM_VALUE = "__custom_stream__";

const changedExactlyOneStream = (data: { id: string }[] | null) => data?.length === 1;

export const StreamLinkManager = ({ clubId }: { clubId: string }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const [tours, setTours] = useState<Tour[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [tourId, setTourId] = useState("");
  const [platform, setPlatform] = useState<StreamPlatform>("youtube");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tournamentRows } = await supabase
      .from("tournaments")
      .select("id,name")
      .eq("club_id", clubId)
      .order("start_time", { ascending: false });
    const nextTours = (tournamentRows ?? []) as Tour[];
    setTours(nextTours);

    const tournamentIds = nextTours.map((tournament) => tournament.id);
    const linkedStreams = tournamentIds.length
      ? supabase.from("tournament_streams").select("*").in("tournament_id", tournamentIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Stream[] });
    const customStreams = userId
      ? supabase.from("tournament_streams").select("*").is("tournament_id", null).eq("created_by", userId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Stream[] });
    const [{ data: linked }, { data: custom }] = await Promise.all([linkedStreams, customStreams]);

    setStreams(
      [...((linked ?? []) as Stream[]), ...((custom ?? []) as Stream[])]
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    );
    setLoading(false);
  }, [clubId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!userId || !tourId) {
      toast.error("Hãy chọn giải đấu hoặc Stream tùy chỉnh.");
      return;
    }

    const validation = validateStreamUrl(platform, url);
    if (!validation.ok) {
      toast.error(validation.error!);
      return;
    }

    const isCustom = tourId === CUSTOM_STREAM_VALUE;
    setSaving(true);
    const { data, error } = await supabase
      .from("tournament_streams")
      .insert({
        tournament_id: isCustom ? null : tourId,
        custom_tournament_name: isCustom ? customName.trim() || "Stream tùy chỉnh" : null,
        platform,
        stream_url: url.trim(),
        embed_id: validation.embedId ?? null,
        title: title.trim() || null,
        is_live: true,
      })
      .select("id");
    setSaving(false);

    if (error || !changedExactlyOneStream(data)) {
      toast.error(error?.message ?? "Không thể lưu stream. Bạn không có quyền hoặc dữ liệu đã thay đổi.");
      return;
    }

    toast.success("Đã thêm stream.");
    setUrl("");
    setTitle("");
    setCustomName("");
    void load();
  };

  const toggleLive = async (stream: Stream) => {
    const { data, error } = await supabase
      .from("tournament_streams")
      .update({ is_live: !stream.is_live })
      .eq("id", stream.id)
      .select("id");

    if (error || !changedExactlyOneStream(data)) {
      toast.error(error?.message ?? "Không thể cập nhật stream. Bạn không có quyền hoặc stream không còn tồn tại.");
      return;
    }

    setStreams((previous) => previous.map((item) => item.id === stream.id ? { ...item, is_live: !stream.is_live } : item));
  };

  const remove = async (stream: Stream) => {
    if (!confirm("Xóa stream này?")) return;

    const { data, error } = await supabase
      .from("tournament_streams")
      .delete()
      .eq("id", stream.id)
      .select("id");

    if (error || !changedExactlyOneStream(data)) {
      toast.error(error?.message ?? "Không thể xóa stream. Bạn không có quyền hoặc stream không còn tồn tại.");
      return;
    }

    setStreams((previous) => previous.filter((item) => item.id !== stream.id));
  };

  const tourMap = Object.fromEntries(tours.map((tournament) => [tournament.id, tournament.name]));
  const isCustom = tourId === CUSTOM_STREAM_VALUE;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-display font-bold">
          <Radio className="h-4 w-4 text-gold" />
          Thêm stream mới
        </h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Gắn stream với</Label>
            <Select value={tourId} onValueChange={setTourId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn giải hoặc Stream tùy chỉnh" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_STREAM_VALUE}>Stream tùy chỉnh của bạn (không gắn giải)</SelectItem>
                {tours.map((tournament) => (
                  <SelectItem key={tournament.id} value={tournament.id}>{tournament.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isCustom && (
              <p className="mt-1 text-xs text-muted-foreground">Dán link phát từ bên ngoài; stream này không cần giải đấu và chỉ bạn có thể quản lý.</p>
            )}
          </div>

          <div>
            <Label className="text-xs">Nền tảng</Label>
            <Select value={platform} onValueChange={(value) => setPlatform(value as StreamPlatform)}>
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
              onChange={(event) => setUrl(event.target.value)}
              placeholder={platform === "youtube" ? "https://youtube.com/watch?v=..." : "https://facebook.com/.../videos/..."}
            />
          </div>

          {isCustom && (
            <div className="md:col-span-2">
              <Label className="text-xs">Tên hiển thị (tuỳ chọn)</Label>
              <Input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Ví dụ: Bàn chung kết ngoài hệ thống"
              />
            </div>
          )}

          <div className="md:col-span-2">
            <Label className="text-xs">Tiêu đề (tuỳ chọn)</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Final Table Day 3" />
          </div>
        </div>

        <Button onClick={add} disabled={saving} className="gradient-gold border-0 text-primary-foreground">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" /> Thêm stream</>}
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-display font-bold">Streams hiện có</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : streams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có stream nào cho CLB này hoặc stream tùy chỉnh của bạn.</p>
        ) : (
          <div className="space-y-2">
            {streams.map((stream) => {
              const streamName = stream.tournament_id
                ? tourMap[stream.tournament_id] ?? "Giải đã không còn"
                : stream.custom_tournament_name ?? "Stream tùy chỉnh";

              return (
                <div key={stream.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{stream.platform}</span>
                      <span className="truncate text-sm font-semibold">{streamName}</span>
                      {stream.is_live && <span className="text-[10px] font-bold text-destructive">● LIVE</span>}
                    </div>
                    <a href={stream.stream_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground hover:text-primary">
                      {stream.stream_url}
                    </a>
                    {stream.title && <div className="text-xs italic text-muted-foreground">{stream.title}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={stream.is_live}
                      onCheckedChange={() => void toggleLive(stream)}
                      aria-label={`Đổi trạng thái phát trực tiếp của ${streamName}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void remove(stream)}
                      aria-label={`Xóa ${streamName}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
