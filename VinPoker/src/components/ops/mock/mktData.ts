// DỮ LIỆU MẪU (mock) for the mobileOpsV2 Marketing screens (M1/M2 + P6). NO Supabase / RPC.
// Composer + list + row actions on mobile. Channel setup / automation / staff = desktop.

export type PostStatus = "draft" | "scheduled" | "posted";
export type Channel = "telegram" | "facebook" | "zalo";

export interface Post {
  id: string;
  title: string;
  excerpt: string;
  status: PostStatus;
  channels: Channel[];
  when: string;         // "18:30 hôm nay" | "đã đăng 20:05" | "nháp"
}

export const CHANNELS: { key: Channel; label: string; connected: boolean }[] = [
  { key: "telegram", label: "Telegram", connected: true },
  { key: "facebook", label: "Facebook", connected: true },
  { key: "zalo", label: "Zalo OA", connected: false },
];

export const CHANNEL_LABEL: Record<Channel, string> = {
  telegram: "Telegram", facebook: "Facebook", zalo: "Zalo OA",
};

export const MKT_POSTS: Post[] = [
  { id: "p1", title: "Sunday Major 20:00", excerpt: "GTĐ 200tr · buy-in 1.1tr · late reg 10 level…", status: "scheduled", channels: ["telegram", "facebook"], when: "18:30 hôm nay" },
  { id: "p2", title: "Ưu đãi F&B cuối tuần", excerpt: "Combo đêm giảm 20% cho khách chơi giải…", status: "draft", channels: ["telegram"], when: "nháp" },
  { id: "p3", title: "Kết quả Daily Turbo", excerpt: "Vô địch: Minh — 12.4tr. Cảm ơn 48 anh em…", status: "posted", channels: ["telegram", "facebook"], when: "đã đăng 20:05" },
  { id: "p4", title: "Lịch giải tuần tới", excerpt: "T2 Deep Stack · T4 Bounty · T7 Major…", status: "draft", channels: [], when: "nháp" },
];

export const STATUS_META: Record<PostStatus, { label: string; cls: string }> = {
  draft: { label: "Nháp", cls: "bg-white/8 text-[#9b8e97]" },
  scheduled: { label: "Đã lên lịch", cls: "bg-amber-400/12 text-amber-300" },
  posted: { label: "Đã đăng", cls: "bg-emerald-400/12 text-emerald-300" },
};
