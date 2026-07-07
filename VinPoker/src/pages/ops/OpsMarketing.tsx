import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, ListChecks, PenSquare, ImagePlus, Send, Clock, Pencil, Trash2, Monitor, Check,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MKT_POSTS, CHANNELS, CHANNEL_LABEL, STATUS_META, type Post, type Channel } from "@/components/ops/mock/mktData";

/**
 * Marketing (mobileOpsV2) — theo bản vẽ đã duyệt M1/M2 + P6:
 * pills Bài viết(M1) · Soạn bài(P6). Tap bài → M2 (đăng/lên lịch/sửa/xoá).
 * DỮ LIỆU MẪU, read-only. Đăng/lên lịch (ghi ra kênh) nhắc lại kênh rồi mới xác nhận.
 * Cấu hình kênh · tự động hoá · nhân sự = máy tính.
 */
const PILLS = [
  { key: "posts", label: "Bài viết", icon: ListChecks },
  { key: "compose", label: "Soạn bài", icon: PenSquare },
] as const;
type Pill = (typeof PILLS)[number]["key"];

export default function OpsMarketing() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("posts");
  const [postSheet, setPostSheet] = useState<Post | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; onOk: () => void } | null>(null);
  const [text, setText] = useState("");
  const [chans, setChans] = useState<Channel[]>(["telegram"]);
  const [mode, setMode] = useState<"now" | "later">("now");

  const ask = (c: NonNullable<typeof confirm>) => setConfirm(c);
  const done = (m: string) => { setPostSheet(null); setConfirm(null); toast.success(m + " (bản mẫu)"); };
  const toggleChan = (c: Channel) => setChans((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);
  const chanNames = (cs: Channel[]) => cs.length ? cs.map((c) => CHANNEL_LABEL[c]).join(" + ") : "chưa chọn kênh";

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Marketing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · Telegram + Facebook</p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {/* M1 — Bài viết */}
      {pill === "posts" && (
        <div className="ios-group">
          {MKT_POSTS.map((p) => {
            const s = STATUS_META[p.status];
            return (
              <button key={p.id} onClick={() => setPostSheet(p)}
                className="ios-press-sm ios-row-inset flex w-full items-start gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-[#f2ece6]">{p.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#9b8e97]">{p.excerpt}</span>
                  <span className="mt-1 block text-[11px] text-[#7c7079]">{chanNames(p.channels)} · {p.when}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.cls)}>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* P6 — Soạn bài */}
      {pill === "compose" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Nội dung bài đăng…"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
            <button onClick={() => toast("Thêm ảnh (bản mẫu)")} className="ios-press-sm mt-1 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[13px] text-[#c9a86a]">
              <ImagePlus className="h-4 w-4" /> Thêm ảnh
            </button>
          </div>

          <div className="ios-card p-3.5">
            <div className="text-[13px] text-[#9b8e97]">Đăng lên kênh</div>
            <div className="mt-2 space-y-1.5">
              {CHANNELS.map((c) => (
                <button key={c.key} disabled={!c.connected} onClick={() => toggleChan(c.key)}
                  className={cn("ios-press-sm flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", !c.connected && "opacity-45")}>
                  <span className={cn("grid h-5 w-5 place-items-center rounded-md border", chans.includes(c.key) ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}><Check className="h-3.5 w-3.5" /></span>
                  <span className="flex-1 text-[14px] text-[#f2ece6]">{c.label}</span>
                  {!c.connected && <span className="text-[11px] text-[#7c7079]">chưa nối · máy tính</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="ios-card p-3.5">
            <div className="text-[13px] text-[#9b8e97]">Thời điểm</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["now", "later"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn("ios-press-sm rounded-2xl py-2.5 text-[14px] font-medium", mode === m ? "bg-[#c9a86a] text-[#241A08]" : "ios-fill text-[#f2ece6]")}>{m === "now" ? "Đăng ngay" : "Lên lịch"}</button>
              ))}
            </div>
            {mode === "later" && (
              <button onClick={() => toast("Chọn thời gian (bản mẫu)")} className="ios-press-sm ios-fill mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] text-[#f2ece6]">
                <Clock className="h-4 w-4 text-[#c9a86a]" /> 18:30 hôm nay <span className="ml-auto text-[12px] text-[#9b8e97]">đổi</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => done("Đã lưu nháp")} className="ios-press-sm ios-fill rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6]">Lưu nháp</button>
            <button disabled={!text.trim() || chans.length === 0}
              onClick={() => ask({ title: mode === "now" ? "Đăng bài ngay" : "Lên lịch đăng", body: `${mode === "now" ? "Đăng ngay" : "Lên lịch 18:30 hôm nay"} lên ${chanNames(chans)}?` , onOk: () => { setText(""); done(mode === "now" ? "Đã đăng bài" : "Đã lên lịch"); } })}
              className="ios-press ios-primary flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-bold disabled:opacity-40"><Send className="h-4 w-4" /> {mode === "now" ? "Đăng ngay" : "Lên lịch"}</button>
          </div>
        </div>
      )}

      {/* M2 — post actions sheet */}
      <Sheet open={postSheet !== null} onOpenChange={(v) => { if (!v) setPostSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="text-[#f2ece6]">{postSheet?.title}</SheetTitle>
          </SheetHeader>
          <p className="mt-1 text-[13px] text-[#9b8e97]">{postSheet?.excerpt}</p>
          <p className="mt-1 text-[11px] text-[#7c7079]">{postSheet && chanNames(postSheet.channels)} · {postSheet?.when}</p>
          <div className="mt-3 space-y-1.5">
            {postSheet?.status !== "posted" && (
              <button onClick={() => ask({ title: "Đăng bài ngay", body: `Đăng "${postSheet?.title}" lên ${postSheet && chanNames(postSheet.channels.length ? postSheet.channels : ["telegram"])} ngay?`, onOk: () => done("Đã đăng bài") })}
                className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left"><Send className="h-5 w-5 shrink-0" /><span className="text-[15px] font-bold">Đăng ngay</span></button>
            )}
            {postSheet?.status === "draft" && (
              <SheetRow icon={<Clock className="h-5 w-5 text-amber-300" />} label="Lên lịch đăng" onTap={() => ask({ title: "Lên lịch đăng", body: `Lên lịch "${postSheet?.title}" 18:30 hôm nay?`, onOk: () => done("Đã lên lịch") })} />
            )}
            {postSheet?.status === "scheduled" && (
              <SheetRow icon={<Clock className="h-5 w-5 text-amber-300" />} label="Đổi giờ / huỷ lịch" onTap={() => ask({ title: "Huỷ lịch đăng", danger: true, body: `Huỷ lịch đăng "${postSheet?.title}"? Bài trở về nháp.`, onOk: () => done("Đã huỷ lịch") })} />
            )}
            <SheetRow icon={<Pencil className="h-5 w-5 text-sky-300" />} label="Sửa nội dung" onTap={() => { setPill("compose"); setText(postSheet?.excerpt ?? ""); setPostSheet(null); }} />
            {postSheet?.status !== "posted" && (
              <SheetRow icon={<Trash2 className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Xoá bài</span>} onTap={() => ask({ title: "Xoá bài", danger: true, body: `Xoá "${postSheet?.title}"? Không khôi phục được.`, onOk: () => done("Đã xoá bài") })} />
            )}
          </div>
          <div className="ios-card mt-3 flex items-start gap-2 p-3 text-[12px] text-[#9b8e97]">
            <Monitor className="mt-0.5 h-4 w-4 shrink-0" /> Nối kênh, bật tự động hoá, phân quyền nhân sự làm trên máy tính.
          </div>
        </SheetContent>
      </Sheet>

      {/* Publish / danger restate confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent className="max-w-[340px] rounded-3xl border-white/10 bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#f2ece6]">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-[14px] text-[#c7bcc4]">{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="ios-press-sm mt-0 rounded-2xl border-white/12 bg-white/5 text-[#f2ece6]">Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm?.onOk()}
              className={cn("ios-press rounded-2xl font-bold", confirm?.danger ? "bg-rose-500/90 text-white hover:bg-rose-500" : "bg-[#c9a86a] text-[#241A08] hover:bg-[#d8bc85]")}>Xác nhận</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SheetRow({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}<span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}
