import { useState } from "react";
import { Megaphone, Send, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useMarketingPosts } from "@/lib/series-intelligence/useMarketingPosts";
import type { CampaignLogInsert } from "@/lib/series-intelligence/captureTypes";

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const snippet = (p: { title: string | null; body: string }): string =>
  (p.title?.trim() || p.body.trim() || "(không tiêu đề)").slice(0, 80);

/**
 * W7 — one-tap "import a sent Telegram post as a campaign log". Reads the club's already-sent marketing
 * posts (read-only), lets the owner pick one + type its spend + link it to a series event, then saves a
 * `series_campaign_logs` row via the existing capture insert. Degrades to a note when marketing data
 * isn't readable (no role / RLS). Gated by FEATURES.seriesMarketingImport.
 */
export function MarketingImportPanel({
  clubId,
  events,
  onImport,
}: {
  clubId: string | undefined;
  events: { id: string; name: string | null }[];
  onImport: (p: Omit<CampaignLogInsert, "club_id">) => Promise<boolean>;
}) {
  const { posts, loading, available } = useMarketingPosts(clubId);
  const [postId, setPostId] = useState("");
  const [eventId, setEventId] = useState("");
  const [spend, setSpend] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const post = posts.find((p) => p.id === postId) ?? null;
  const canSave = !!post && !!eventId && !saving;

  const save = async (): Promise<void> => {
    if (!post || !eventId) return;
    setSaving(true);
    const ok = await onImport({
      event_linked: eventId,
      channel: post.channels[0] ?? "telegram",
      creative_type: "telegram_post",
      spend: spend ?? null,
      decision_reason: `Bài Telegram đã gửi: ${snippet(post)}`,
    });
    setSaving(false);
    if (ok) {
      setSavedId(post.id);
      setPostId("");
      setSpend(null);
    }
  };

  return (
    <Card className="p-3 border-primary/30 space-y-2.5 text-xs">
      <div className="flex items-center gap-2 font-display text-sm">
        <Megaphone className="h-4 w-4 text-primary" /> Nhập từ bài Telegram đã gửi
      </div>

      {!available ? (
        <p className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          {loading
            ? "Đang đọc bài marketing…"
            : "Chưa đọc được bài marketing đã gửi (có thể CLB chưa bật marketing hoặc bạn chưa có quyền). Bạn vẫn có thể ghi chiến dịch thủ công ở phần Chiến dịch phía trên."}
        </p>
      ) : posts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          Chưa có bài Telegram nào đã gửi để nhập.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Bài đã gửi</span>
              <Select value={postId || undefined} onValueChange={setPostId}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Chọn bài" /></SelectTrigger>
                <SelectContent>
                  {posts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{snippet(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Gắn vào giải</span>
              <Select value={eventId || undefined} onValueChange={setEventId}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Chọn giải" /></SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name ?? e.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Chi phí (đ, tùy chọn)</span>
              <Input type="number" className="h-8" placeholder="vd 500000" value={spend ?? ""} onChange={(e) => setSpend(numOrNull(e.target.value))} />
            </label>
            <div className="flex items-end">
              <Button size="sm" className="h-8 w-full gap-1.5" disabled={!canSave} onClick={save}>
                <Send className="h-3.5 w-3.5" /> {saving ? "Đang lưu…" : "Lưu thành chiến dịch"}
              </Button>
            </div>
          </div>
          {savedId && (
            <div className={cn("flex items-center gap-1 text-[11px] text-primary")}>
              <Check className="h-3 w-3" /> Đã lưu 1 chiến dịch. Nhập chi phí thật để đo hiệu quả marketing về sau.
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/80">
            Lưu bài đã gửi thành log chiến dịch (kênh + chi phí) gắn với giải — để sau đối chiếu giải có chạy bài
            vs không chạy. Chưa tự động 100%; chi phí bạn tự nhập.
          </p>
        </>
      )}
    </Card>
  );
}
